'use strict';

const assert = require('node:assert/strict');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getTargets() {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:9222/json/list');
      if (response.ok) {
        const targets = await response.json();
        if (targets.some((target) => target.type === 'page')) return targets;
      }
      lastError = new Error('DevTools endpoint returned no page targets');
    } catch (error) { lastError = error; }
    await sleep(400);
  }
  throw new Error('Electron DevTools did not become ready: ' + lastError?.message);
}

async function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DevTools WebSocket connection timed out')), 10000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('DevTools WebSocket connection failed')); }, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (!message.id || !pending.has(message.id)) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  });
  return {
    async send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('DevTools command timed out: ' + method));
        }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression) {
      const result = await this.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true, userGesture: true
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      }
      return result.result?.value;
    },
    close() { socket.close(); }
  };
}

async function run() {
  const targets = await getTargets();
  const chatTarget = targets.find((target) =>
    target.type === 'page' && (target.url || '').toLowerCase().includes('/chat.html')
  );
  assert.ok(chatTarget, 'A real chat.html renderer target must be open in the packaged app');
  const cdp = await connect(chatTarget);
  try {
    await cdp.send('Runtime.enable');
    const initial = await cdp.evaluate("(() => ({ title: document.title, ready: document.readyState, header: !!document.querySelector('.chat-header'), messageInput: !!document.querySelector('#messageInput'), sendButton: !!document.querySelector('#sendButton'), recordButton: !!document.querySelector('#screenRecordBtn'), micButton: !!document.querySelector('#micButton'), systemAudioButton: !!document.querySelector('#systemAudioListenBtn'), overlayButton: !!document.querySelector('#overlayToggleBtn'), screenX: window.screenX, screenY: window.screenY }))()");
    assert.equal(initial.ready, 'complete', 'Chat renderer must finish loading');
    for (const control of ['header', 'messageInput', 'sendButton', 'recordButton', 'micButton', 'systemAudioButton', 'overlayButton']) {
      assert.equal(initial[control], true, 'Live chat UI missing required element: ' + control);
    }

    await cdp.evaluate("(() => { const header = document.querySelector('.chat-header .header-title'); const startX = window.screenX + 80; const startY = window.screenY + 20; header.dispatchEvent(new PointerEvent('pointerdown', { bubbles:true, pointerId:71, pointerType:'mouse', isPrimary:true, button:0, buttons:1, clientX:80, clientY:20, screenX:startX, screenY:startY })); header.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, pointerId:71, pointerType:'mouse', isPrimary:true, button:0, buttons:1, clientX:110, clientY:35, screenX:startX+30, screenY:startY+15 })); header.dispatchEvent(new PointerEvent('pointerup', { bubbles:true, pointerId:71, pointerType:'mouse', isPrimary:true, button:0, buttons:0, clientX:110, clientY:35, screenX:startX+30, screenY:startY+15 })); return true; })()");
    await sleep(500);
    const moved = await cdp.evaluate('({ x: window.screenX, y: window.screenY })');
    assert.ok(moved.x !== initial.screenX || moved.y !== initial.screenY,
      'Dragging chat header must move native window (before ' + initial.screenX + ',' + initial.screenY + '; after ' + moved.x + ',' + moved.y + ')');

    const oldTitle = await cdp.evaluate("document.querySelector('#overlayToggleBtn').title");
    await cdp.evaluate("document.querySelector('#overlayToggleBtn').click()");
    await sleep(300);
    const toggledTitle = await cdp.evaluate("document.querySelector('#overlayToggleBtn').title");
    assert.notEqual(toggledTitle, oldTitle, 'Overlay click must change the visible state');
    await cdp.evaluate("document.querySelector('#overlayToggleBtn').click()");
    await sleep(300);
    const restoredTitle = await cdp.evaluate("document.querySelector('#overlayToggleBtn').title");
    assert.equal(restoredTitle, oldTitle, 'Overlay button must toggle back to its original state');

    // Screen button is now a live vision stream, not a file recorder.
    const liveScreenContract = await cdp.evaluate("({ title: document.querySelector('#screenRecordBtn').title, start: typeof startLiveScreenMode, stop: typeof stopLiveScreenMode, ask: typeof askAIAboutScreen, analyze: typeof captureAndAskAI })");
    assert.equal(liveScreenContract.title, 'Start live screen AI (analyze screen continuously)',
      'Screen control must advertise live AI analysis, not saving a recording');
    assert.equal(liveScreenContract.start, 'function', 'Live screen mode must be implemented');
    assert.equal(liveScreenContract.stop, 'function', 'Live screen mode must have a stop path');
    assert.equal(liveScreenContract.ask, 'function', 'Capture screen and ask AI must be implemented');
    assert.equal(liveScreenContract.analyze, 'function', 'Screen frames must be sent to the AI analysis pipeline');

    // Exercise the built-in audio controls without opening OS pickers or
    // requiring a physical microphone on the hosted runner. Simulate a denied
    // mic permission and a display source without audio; neither path should
    // demand Whisper configuration.
    await cdp.evaluate("(() => { const old = { getUserMedia: Object.getOwnPropertyDescriptor(navigator.mediaDevices, 'getUserMedia'), getDisplayMedia: Object.getOwnPropertyDescriptor(navigator.mediaDevices, 'getDisplayMedia') }; Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { configurable: true, writable: true, value: async () => { throw new Error('Synthetic microphone permission denial'); } }); const videoTrack = { kind: 'video', stop() {}, addEventListener() {} }; Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, writable: true, value: async () => ({ getTracks: () => [videoTrack], getVideoTracks: () => [videoTrack], getAudioTracks: () => [] }) }); Object.defineProperty(window, '__openCluelyAudioTestRestore', { configurable: true, value: () => { if (old.getUserMedia) Object.defineProperty(navigator.mediaDevices, 'getUserMedia', old.getUserMedia); else delete navigator.mediaDevices.getUserMedia; if (old.getDisplayMedia) Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', old.getDisplayMedia); else delete navigator.mediaDevices.getDisplayMedia; } }); return true; })()");
    await cdp.evaluate("document.querySelector('#micButton').click()");
    await cdp.evaluate("document.querySelector('#systemAudioListenBtn').click()");
    await sleep(300);
    const audioState = await cdp.evaluate("document.querySelector('#chatMessages').textContent");
    assert.match(audioState, /Could not start microphone capture: Synthetic microphone permission denial/, 'Built-in microphone control must request capture without requiring Whisper');
    assert.match(audioState, /selected source provided no system-audio track/i, 'System-audio control must validate the selected source without requiring Whisper');
    assert.doesNotMatch(audioState, /Speech recognition is not configured\.|Configure Whisper speech recognition/, 'Built-in audio controls must not gate capture on Whisper setup');
    await cdp.evaluate("window.__openCluelyAudioTestRestore(); delete window.__openCluelyAudioTestRestore;");

    const targetsBeforeSend = await getTargets();
    const responseTargetsBefore = targetsBeforeSend.filter((target) => target.type === 'page' && /AI Response/i.test(target.title || '')).length;
    const originalSendChatMessage = await cdp.evaluate("(() => { const original = window.electronAPI.sendChatMessage; window.electronAPI.sendChatMessage = async (text) => ({ success: true, response: 'MOCK-ANSWER: ' + text }); return original.toString(); })()");
    const marker = 'UI-INTEGRATION-' + Date.now();
    await cdp.evaluate("(() => { const input = document.querySelector('#messageInput'); input.value = " + JSON.stringify(marker) + "; document.querySelector('#sendButton').click(); return true; })()");
    await sleep(100);
    const buttonMessageState = await cdp.evaluate("(() => ({ user: Array.from(document.querySelectorAll('#chatMessages .message.user')).some(el => el.textContent.includes(" + JSON.stringify(marker) + ")), answer: Array.from(document.querySelectorAll('#chatMessages .message.assistant')).some(el => el.textContent.includes('MOCK-ANSWER: ' + " + JSON.stringify(marker) + ")), value: document.querySelector('#messageInput').value, thinking: !!document.querySelector('#thinking-indicator') }))()");
    assert.equal(buttonMessageState.user, true, 'Send-button submission must render the user message');
    assert.equal(buttonMessageState.answer, true, 'Send-button submission must render the returned assistant answer in the same chat window');
    assert.equal(buttonMessageState.value, '', 'Sending a message must clear the input');
    assert.equal(buttonMessageState.thinking, false, 'Thinking indicator must be removed after a successful answer');

    const enterMarker = 'ENTER-INTEGRATION-' + Date.now();
    await cdp.evaluate("(() => { const input = document.querySelector('#messageInput'); input.value = " + JSON.stringify(enterMarker) + "; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return true; })()");
    await sleep(100);
    const enterState = await cdp.evaluate("(() => ({ user: Array.from(document.querySelectorAll('#chatMessages .message.user')).some(el => el.textContent.includes(" + JSON.stringify(enterMarker) + ")), answer: Array.from(document.querySelectorAll('#chatMessages .message.assistant')).some(el => el.textContent.includes('MOCK-ANSWER: ' + " + JSON.stringify(enterMarker) + ")) }))()");
    assert.equal(enterState.user, true, 'Enter-key submission must render the user message');
    assert.equal(enterState.answer, true, 'Enter-key submission must render the returned assistant answer in the same chat window');
    await cdp.evaluate("window.electronAPI.sendChatMessage = " + originalSendChatMessage + ";");
    const refreshedTargets = await getTargets();
    const responseTargetsAfter = refreshedTargets.filter((target) => target.type === 'page' && /AI Response/i.test(target.title || '')).length;
    assert.equal(responseTargetsAfter, responseTargetsBefore,
      'Sending a chat message must not spawn a separate AI Response window');

    console.log('PASS: live Electron chat DOM, native window drag IPC, reversible overlay toggle, and same-window message submission.');
  } finally { cdp.close(); }
}

run().catch((error) => {
  console.error('FAIL: live chat UI integration test:', error.stack || error.message);
  process.exitCode = 1;
});
