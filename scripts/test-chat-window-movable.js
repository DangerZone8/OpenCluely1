const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('chat.html', 'utf8');
const manager = fs.readFileSync('src/managers/window.manager.js', 'utf8');
const onboarding = fs.readFileSync('onboarding.html', 'utf8');
const onboardingScript = fs.readFileSync('onboarding.js', 'utf8');
const main = fs.readFileSync('main.js', 'utf8');
const preload = fs.readFileSync('preload.js', 'utf8');

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
  'Chat must expose the live screen AI control');
assert.match(html, /chatHeader\.addEventListener\('pointermove'/,
  'Chat must have an explicit pointer-based drag fallback');
assert.match(preload, /moveChatWindow:\s*\(deltaX, deltaY\)\s*=>\s*ipcRenderer\.send\('move-chat-window'/,
  'Chat movement must be exposed through a dedicated preload IPC method');
assert.match(main, /ipcMain\.on\("move-chat-window"[\s\S]*?chatWindow\.setPosition/,
  'Main process must move only the chat window receiving the drag event');
assert.match(preload, /analyzeScreenFrame:.*analyze-live-screen-frame/,
  'Screen frames must be sent through a dedicated AI analysis IPC');
assert.match(main, /ipcMain\.handle\("analyze-live-screen-frame"[\s\S]*?llmService\.analyzeScreenFrame/,
  'Main process must route screen frames directly to visual AI analysis');
assert.match(html, /async function startLiveScreenMode\(/,
  'Screen control must start a live AI viewing session');
assert.match(html, /const LIVE_FRAME_INTERVAL_MS = 1500/,
  'Live screen AI must use a responsive frame interval while enabled');
assert.match(html, /setTimeout\(sendFrame, LIVE_FRAME_INTERVAL_MS\)/,
  'Live screen AI must schedule the next fresh frame after the previous analysis completes');
assert.match(html, /liveScreenFrameInFlight/,
  'Live screen AI must prevent overlapping frame-analysis requests');
assert.match(html, /async function askAIAboutScreen\(/,
  'Capture screen and ask AI must send a selected screen frame for analysis');
assert.match(html, /analyzeScreenFrame\(bytes, 'image\/jpeg'/,
  'Screen frame must reach the AI instead of being saved as a video');
assert.match(html, /id="micButton"[^>]*title="Start or stop microphone listening"/,
  'Chat must label microphone listening explicitly');
assert.match(preload, /getSpeechCaptureMode:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('get-speech-capture-mode'/,
  'Renderer must be told whether it owns microphone capture');
assert.match(main, /ipcMain\.handle\("get-speech-capture-mode"[\s\S]*?rendererCaptureSupported/,
  'Main process must expose supported speech capture mode');
assert.match(html, /getUserMedia\(\s*\{[\s\S]*?echoCancellation:\s*true/,
  'Microphone listening must request permission and capture real audio');
assert.match(html, /createScriptProcessor\(4096,\s*1,\s*1\)/,
  'Renderer must process captured microphone audio into transcription chunks');
assert.match(html, /whysperAPI\.sendAudioChunk\(pcm\.buffer\)/,
  'Captured PCM audio must be forwarded to the Whisper transcription service');
assert.match(html, /stopRendererMicCapture\(\)/,
  'Microphone capture must be stopped and released when listening stops');
assert.match(html, /id="systemAudioListenBtn"/,
  'Chat must expose a separate system-audio listening control');
assert.match(html, /getDisplayMedia\(\s*\{\s*video:\s*true,\s*audio:\s*true\s*\}\)/,
  'Live system-audio listening must use an explicit display/window picker');
assert.match(html, /pendingSystemAudioStream/,
  'Selected system audio must feed the renderer audio transcription pipeline');
assert.match(html, /Stop listening to screen audio/,
  'System-audio listening must have an explicit stop control');
assert.match(html, /id="overlayToggleBtn"/,
  'Chat must expose overlay visibility control');
assert.match(manager, /setOverlayMode\(enabled\)[\s\S]*?setAlwaysOnTop\(this\.overlayModeEnabled\)[\s\S]*?return this\.overlayModeEnabled/,
  'Overlay mode must be reversible without hiding the chat control');
assert.match(html, /result\.enabled[\s\S]*?Turn overlay off[\s\S]*?Turn overlay on/,
  'Overlay control must visibly expose both on and off states');
assert.match(onboarding, /id="openAiNowBtn"/,
  'Welcome screen must expose direct AI chat access');
assert.match(onboardingScript, /openAiNowBtn\.addEventListener/,
  'Welcome screen direct AI action must be wired');
console.log('Chat drag, unified response routing, controls, and welcome shortcut checks passed.');
