const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('chat.html', 'utf8');
const manager = fs.readFileSync('src/managers/window.manager.js', 'utf8');
const onboarding = fs.readFileSync('onboarding.html', 'utf8');
const onboardingScript = fs.readFileSync('onboarding.js', 'utf8');

const containerRule = html.match(/\.chat-container\s*\{([^}]*)\}/s);
assert(containerRule, 'Chat container CSS rule must exist');
assert.match(containerRule[1], /-webkit-app-region:\s*no-drag/,
  'Chat content must remain interactive instead of being a drag surface');
assert.doesNotMatch(containerRule[1], /-webkit-app-region:\s*drag/,
  'Chat container must not override no-drag with a later drag declaration');
assert.match(html, /\.chat-header\s*\{[^}]*-webkit-app-region:\s*drag/s,
  'Chat header must be draggable');
assert.match(html, /\.header-title\s*\{[^}]*-webkit-app-region:\s*drag/s,
  'Chat title/icon must provide a clear drag handle');
assert.match(html, /\.header-actions\s*\{[^}]*-webkit-app-region:\s*no-drag/s,
  'Header actions must remain clickable');
assert.match(html, /\.icon-button\s*\{[^}]*-webkit-app-region:\s*no-drag/s,
  'Header buttons must remain clickable');
assert.match(manager, /else if \(type === 'chat'\)\s*\{[\s\S]*?frame:\s*false,[\s\S]*?resizable:\s*true/,
  'Chat window must remain a frameless, resizable Electron window');
assert.match(manager, /else if \(type === 'main'\)\s*\{[\s\S]*?frame:\s*true,[\s\S]*?transparent:\s*false/,
  'Main app must use a native OS frame for normal window movement and controls');
assert.match(manager, /thickFrame:\s*type === 'main'/,
  'Windows-specific options must preserve the main window native frame');
assert.match(onboarding, /\.header\s*\{[^}]*-webkit-app-region:\s*drag/s,
  'Welcome onboarding header must be draggable');
assert.match(manager, /onboarding:\s*\{[\s\S]*?file:\s*'onboarding\.html'/,
  'Welcome onboarding window must remain configured');

// Runtime interaction must be restored on every explicit chat open, not just
// declared in CSS; click-through mode otherwise leaves the chat visible but stuck.
assert.match(manager, /showChatWindow\(\)\s*\{[\s\S]*?setIgnoreMouseEvents\(false\)[\s\S]*?setFocusable\(true\)/,
  'Showing chat must restore mouse interaction and focusability');
assert.match(manager, /windowType === 'chat'[\s\S]*?this\.showChatWindow\(\)/,
  'Shortcut/onboarding chat opens must use the interactive showChatWindow path');

// All AI responses should render into chat; the legacy response window must
// no longer be shown as the destination for new assistant answers.
assert.match(manager, /showLLMResponse\(content, metadata = \{\}\)\s*\{[\s\S]*?chatWindow\.webContents\.send\('llm-response'/,
  'AI responses must be routed to the chat renderer');
assert.match(html, /id="screenCaptureBtn"/,
  'Chat must expose the existing screenshot/OCR capture workflow');
assert.match(html, /id="screenRecordBtn"/,
  'Chat must expose an actual screen-recording control');
assert.match(html, /getDisplayMedia\(\s*\{[\s\S]*?audio:\s*true/,
  'Screen recording must request display audio where the platform supports it');
assert.match(html, /getUserMedia\(\{\s*audio:\s*true/,
  'Screen recording must request microphone permission only through an explicit opt-in');
assert.match(html, /MAX_SCREEN_RECORDING_BYTES\s*=\s*250\s*\*\s*1024\s*\*\s*1024/,
  'Screen recording must have a bounded memory/file size limit');
assert.match(html, /saveScreenRecording\(new Uint8Array\(bytes\)\)/,
  'Screen recordings must be saved through the preload IPC bridge');
assert.match(html, /id="micButton"[^>]*title="Start or stop microphone listening"/,
  'Chat must label microphone listening explicitly');
assert.match(html, /id="overlayToggleBtn"/,
  'Chat must expose overlay visibility control');
assert.match(onboarding, /id="openAiNowBtn"/,
  'Welcome screen must expose direct AI chat access');
assert.match(onboardingScript, /openAiNowBtn\.addEventListener/,
  'Welcome screen direct AI action must be wired');
console.log('Chat drag, unified response routing, controls, and welcome shortcut checks passed.');
