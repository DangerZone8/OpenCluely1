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

    // Exercise the actual screen-recording button with a deterministic fake
    // capture source. Stop-save is intentionally forced to fail before the
    // native file dialog so CI never opens a user-facing save prompt.
    await cdp.evaluate("(() => { const old = { MediaRecorder: Object.getOwnPropertyDescriptor(window, 'MediaRecorder'), MediaStream: Object.getOwnPropertyDescriptor(window, 'MediaStream'), confirm: Object.getOwnPropertyDescriptor(window, 'confirm'), getDisplayMedia: Object.getOwnPropertyDescriptor(navigator.mediaDevices, 'getDisplayMedia'), blobArrayBuffer: Object.getOwnPropertyDescriptor(Blob.prototype, 'arrayBuffer') }; const track = { kind: 'video', stop() {}, addEventListener() {} }; class FakeStream { constructor(tracks) { this.tracks = tracks || []; } getTracks() { return this.tracks; } getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); } getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); } } class FakeRecorder { static isTypeSupported() { return true; } constructor() { this.state = 'inactive'; this.mimeType = 'video/webm'; this.listeners = {}; } addEventListener(type, callback, options) { (this.listeners[type] ||= []).push({ callback, once: !!(options && options.once) }); } dispatch(type, event) { const listeners = this.listeners[type] || []; this.listeners[type] = listeners.filter(item => !item.once); for (const item of listeners) item.callback(event || { type }); } start() { this.state = 'recording'; setTimeout(() => this.dispatch('dataavailable', { type: 'dataavailable', data: new Blob([new Uint8Array([1,2,3])], { type: this.mimeType }) }), 0); } stop() { this.state = 'inactive'; this.dispatch('stop'); } } Object.defineProperty(window, 'MediaRecorder', { configurable: true, writable: true, value: FakeRecorder }); Object.defineProperty(window, 'MediaStream', { configurable: true, writable: true, value: FakeStream }); Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, writable: true, value: async () => new FakeStream([track]) }); window.confirm = () => false; Blob.prototype.arrayBuffer = async function() { throw new Error('Synthetic UI test stop'); }; Object.defineProperty(window, '__openCluelyLiveTestRestore', { configurable: true, value: () => { if (old.MediaRecorder) Object.defineProperty(window, 'MediaRecorder', old.MediaRecorder); else delete window.MediaRecorder; if (old.MediaStream) Object.defineProperty(window, 'MediaStream', old.MediaStream); else delete window.MediaStream; if (old.confirm) Object.defineProperty(window, 'confirm', old.confirm); else delete window.confirm; if (old.getDisplayMedia) Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', old.getDisplayMedia); else delete navigator.mediaDevices.getDisplayMedia; if (old.blobArrayBuffer) Object.defineProperty(Blob.prototype, 'arrayBuffer', old.blobArrayBuffer); else delete Blob.prototype.arrayBuffer; } }); return true; })()");
    await cdp.evaluate("document.querySelector('#screenRecordBtn').click()");
    await sleep(250);
    const recordingStarted = await cdp.evaluate("({ title: document.querySelector('#screenRecordBtn').title, active: document.querySelector('#screenRecordBtn').classList.contains('recording') })");
    assert.equal(recordingStarted.active, true, 'Screen recording button must start a recording session');
    assert.equal(recordingStarted.title, 'Stop and save screen recording', 'Recording control must expose a stop action while recording');
    await cdp.evaluate("document.querySelector('#screenRecordBtn').click()");
    await sleep(300);
    const recordingStopped = await cdp.evaluate("({ disabled: document.querySelector('#screenRecordBtn').disabled, active: document.querySelector('#screenRecordBtn').classList.contains('recording'), title: document.querySelector('#screenRecordBtn').title, messages: document.querySelector('#chatMessages').textContent })");
    assert.equal(recordingStopped.disabled, false, 'Recording control must be re-enabled after stop');
    assert.equal(recordingStopped.active, false, 'Recording state must clear after stop');
    assert.equal(recordingStopped.title, 'Start screen recording with optional system audio', 'Recording control must return to its start state');
    assert.match(recordingStopped.messages, /Synthetic UI test stop/, 'Recording stop path must reach the save/cleanup handler');
    await cdp.evaluate("window.__openCluelyLiveTestRestore(); delete window.__openCluelyLiveTestRestore;");

    // Audio controls must respond safely when the runner has no configured
    // speech backend or physical capture device; do not trigger OS pickers.
    await cdp.evaluate("document.querySelector('#micButton').click()");
    await cdp.evaluate("document.querySelector('#systemAudioListenBtn').click()");
    await sleep(200);
    const audioState = await cdp.evaluate("document.querySelector('#chatMessages').textContent");
    assert.match(audioState, /Speech recognition is not configured\./, 'Microphone control must explain unavailable speech recognition');
    assert.match(audioState, /Configure Whisper speech recognition before listening to screen audio\./, 'System-audio control must explain missing Whisper setup');

    const targetsBeforeSend = await getTargets();
    const responseTargetsBefore = targetsBeforeSend.filter((target) => target.type === 'page' && /AI Response/i.test(target.title || '')).length;
    const marker = 'UI-INTEGRATION-' + Date.now();
    await cdp.evaluate("(() => { const input = document.querySelector('#messageInput'); input.value = " + JSON.stringify(marker) + "; document.querySelector('#sendButton').click(); return true; })()");
    await sleep(700);
    const messageState = await cdp.evaluate("(() => ({ rendered: Array.from(document.querySelectorAll('#chatMessages .message')).some(el => el.textContent.includes(" + JSON.stringify(marker) + ")), value: document.querySelector('#messageInput').value }))()");
    assert.equal(messageState.rendered, true, 'Submitted message must render in the existing chat window');
    assert.equal(messageState.value, '', 'Sending a message must clear the input');
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
