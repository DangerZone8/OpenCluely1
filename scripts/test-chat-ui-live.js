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

    const marker = 'UI-INTEGRATION-' + Date.now();
    await cdp.evaluate("(() => { const input = document.querySelector('#messageInput'); input.value = " + JSON.stringify(marker) + "; document.querySelector('#sendButton').click(); return true; })()");
    await sleep(700);
    const messageState = await cdp.evaluate("(() => ({ rendered: Array.from(document.querySelectorAll('#chatMessages .message')).some(el => el.textContent.includes(" + JSON.stringify(marker) + ")), value: document.querySelector('#messageInput').value }))()");
    assert.equal(messageState.rendered, true, 'Submitted message must render in the existing chat window');
    assert.equal(messageState.value, '', 'Sending a message must clear the input');
    const refreshedTargets = await getTargets();
    assert.equal(refreshedTargets.some((target) => target.type === 'page' && /AI Response/i.test(target.title || '')), false,
      'Sending a chat message must not create a separate AI Response window');

    console.log('PASS: live Electron chat DOM, native window drag IPC, reversible overlay toggle, and same-window message submission.');
  } finally { cdp.close(); }
}

run().catch((error) => {
  console.error('FAIL: live chat UI integration test:', error.stack || error.message);
  process.exitCode = 1;
});
