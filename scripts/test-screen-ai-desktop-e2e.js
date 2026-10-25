'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const port = 9317;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cleverly-screen-e2e-'));
const logPath = path.join(userData, 'electron.log');
let child;
let socket;
let nextId = 0;
const pending = new Map();

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function getTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  if (!response.ok) throw new Error(`DevTools target list returned HTTP ${response.status}`);
  return response.json();
}
async function waitForChatTarget(timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const targets = await getTargets();
      const target = targets.find(item => item.type === 'page' && /chat\.html/i.test(item.url || ''));
      if (target) return target;
      last = targets.map(item => `${item.type}:${item.url}`).join(', ');
    } catch (error) { last = error.message; }
    await sleep(400);
  }
  throw new Error('Timed out waiting for the actual chat.html renderer. Targets: ' + last);
}
async function connectCdp(target) {
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('DevTools WebSocket connection timed out')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('DevTools WebSocket connection failed')); }, { once: true });
  });
  socket.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data); } catch (_) { return; }
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  });
}
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('DevTools command timed out: ' + method));
      }
    }, 15000).unref?.();
  });
}
async function evaluate(expression, awaitPromise = true) {
  const result = await cdp('Runtime.evaluate', {
    expression, awaitPromise, returnByValue: true, userGesture: true
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value;
}
async function waitForResult(previousCount, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(`(() => {
      const messages = [...document.querySelectorAll('#chatMessages .message')];
      return {
        assistant: messages.filter(e => e.classList.contains('assistant')).map(e => e.innerText.trim()).filter(Boolean),
        errors: messages.filter(e => e.classList.contains('error')).map(e => e.innerText.trim()).filter(Boolean),
        system: messages.filter(e => e.classList.contains('system')).map(e => e.innerText.trim()).filter(Boolean)
      };
    })()`);
    if (last.assistant.length > previousCount) {
      const latest = last.assistant[last.assistant.length - 1];
      assert.ok(latest.length > 0, label + ' produced an empty assistant response');
      assert.doesNotMatch(latest, /Could not connect to any hosted Cleverly AI endpoint|fetch failed|API key.*missing/i,
        label + ' returned an infrastructure error instead of an AI answer: ' + latest);
      return { response: latest, state: last };
    }
    if (last.errors.length) {
      throw new Error(label + ' showed a UI error: ' + last.errors[last.errors.length - 1]);
    }
    await sleep(500);
  }
  throw new Error(label + ' did not render an assistant response within ' + timeoutMs + 'ms. Last UI state: ' + JSON.stringify(last));
}

async function main() {
  if (!process.env.GEMINI_API_KEY && !process.env.CLEVERLY_HOSTED_AI_TEST_OK) {
    throw new Error('A real GEMINI_API_KEY Actions secret is required for desktop screen-AI E2E; refusing to pass with a mock.');
  }
  fs.writeFileSync(path.join(userData, '.env'), 'GEMINI_API_KEY=' + (process.env.GEMINI_API_KEY || '') + '\n', { mode: 0o600 });
  fs.writeFileSync(path.join(userData, '.opencluely-firstrun-completed'), new Date().toISOString());

  const electronPath = require('electron');
  const log = fs.openSync(logPath, 'a');
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '',
    CLEVERLY_E2E_SCREEN_CAPTURE: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    // Exercise the real hosted Gemini vision proxy from the desktop UI. The CI
    // runner's direct Google API fetch can fail independently of the app, and
    // a locally configured endpoint must never send this test to localhost.
    GEMINI_API_KEY: '',
    OPENCLUELY_AI_ENDPOINT: 'https://opencluelys.vercel.app/api/gemini',
    OPENCLUELY_AI_FALLBACK_ENDPOINT: 'https://opencluely-iota.vercel.app/api/gemini'
  };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electronPath, [
    '--no-sandbox', '--disable-gpu', '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '.'
  ], { cwd: root, env, stdio: ['ignore', log, log] });

  child.once('exit', (code, signal) => {
    if (!globalThis.__e2eFinishing) {
      console.error('Electron exited unexpectedly:', { code, signal });
    }
  });

  try {
    const target = await waitForChatTarget();
    await connectCdp(target);
    await cdp('Runtime.enable');

    // Provide a deterministic test display stream inside the real Electron renderer.
    // The UI buttons, canvas frame extraction, preload IPC, main-process LLM service,
    // hosted Gemini vision request, and response rendering remain real.
    // Only the OS-native display picker is replaced because CI has no interactive user.
    const displayStub = await evaluate(`(() => {
      if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('getDisplayMedia is unavailable');
      navigator.mediaDevices.getDisplayMedia = async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1280; canvas.height = 720;
        const context = canvas.getContext('2d');
        let frame = 0;
        const paint = () => {
          context.fillStyle = '#f7f7f7';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = '#111111';
          context.font = 'bold 42px sans-serif';
          context.fillText('Cleverly Desktop Screen AI E2E', 60, 110);
          context.font = '30px sans-serif';
          context.fillText('Analyze this screen and reply with a short summary.', 60, 180);
          context.fillText('Fresh test frame: ' + (++frame), 60, 240);
        };
        paint();
        const timer = setInterval(paint, 500);
        const stream = canvas.captureStream(2);
        stream.getTracks().forEach(track => track.addEventListener('ended', () => clearInterval(timer), { once: true }));
        return stream;
      };
      return 'synthetic desktop display stream ready';
    })()`);
    assert.match(displayStub, /ready/, 'Could not prepare deterministic display stream');

    // Click the actual visible UI control. No direct call to the capture function.
    let before = await evaluate("document.querySelectorAll('#chatMessages .message.assistant').length");
    await evaluate("document.querySelector('#screenCaptureBtn')?.click()");
    let capture = await waitForResult(before, 90000, 'Capture Screen and Ask AI');
    console.log('PASS Capture Screen and Ask AI:', capture.response.slice(0, 240).replace(/\s+/g, ' '));

    // Live Screen AI must acquire a display, submit a fresh frame and render an answer.
    before = await evaluate("document.querySelectorAll('#chatMessages .message.assistant').length");
    await evaluate("document.querySelector('#screenRecordBtn')?.click()");
    await sleep(1200);
    const liveStarted = await evaluate("({title:document.querySelector('#screenRecordBtn')?.title, recording:document.querySelector('#screenRecordBtn')?.classList.contains('recording')})");
    assert.ok(liveStarted.recording || /stop live screen ai/i.test(liveStarted.title || ''),
      'Live Screen AI button did not enter active state: ' + JSON.stringify(liveStarted));
    const live = await waitForResult(before, 100000, 'Live Screen AI');
    console.log('PASS Live Screen AI:', live.response.slice(0, 240).replace(/\s+/g, ' '));
    await evaluate("document.querySelector('#screenRecordBtn')?.click()");
    console.log(JSON.stringify({ status: 'PASS', tests: ['Capture Screen and Ask AI real UI click + live response', 'Live Screen AI real UI click + fresh-frame response'], provider: 'real Gemini/hosted vision request', userData }, null, 2));
  } finally {
    globalThis.__e2eFinishing = true;
    try { socket?.close(); } catch (_) {}
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(5000)]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    try {
      const log = fs.readFileSync(logPath, 'utf8');
      if (process.env.CI && /FATAL|uncaught exception/i.test(log)) console.error('Electron log contains fatal markers.');
      if (process.env.CI && log) console.error('Electron diagnostic log (tail):\\n' + log.slice(-12000));
    } catch (_) {}
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error('DESKTOP SCREEN AI E2E FAILED:', error.stack || error.message);
  process.exitCode = 1;
});
