'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const chat = read('chat.html');
const preload = read('preload.js');
const main = read('main.js');
const llm = read('src/services/llm.service.js');

function has(text, pattern, message) {
  assert.match(text, pattern, message);
}

// Capture Screen and Ask AI button must call the screen-capture function and
// render the returned analysis, not just prove the hosted endpoint is online.
has(chat, /screenCaptureBtn\.addEventListener\('click'[\s\S]{0,500}askAIAboutScreen\(\)/,
  'Capture Screen button is not wired to askAIAboutScreen().');
has(chat, /async function askAIAboutScreen\([\s\S]{0,700}captureAndAskAI\(/,
  'askAIAboutScreen() does not capture a frame.');
has(chat, /async function captureAndAskAI\([\s\S]{0,2600}getDisplayMedia\([\s\S]{0,2600}drawImage\([\s\S]{0,1800}analyzeScreenFrame\(/,
  'Capture Screen path must acquire a display stream, render a frame, and call analyzeScreenFrame().');
has(chat, /if \(result && result\.response\) renderAssistantResponse\(result\.response\)/,
  'Capture Screen path does not render the returned assistant response.');

// Live Screen AI must be wired to its button, create fresh frames, send them
// through the same IPC bridge, and render non-empty results.
has(chat, /screenRecordBtn\.addEventListener\('click'[\s\S]{0,600}startLiveScreenMode\(\)/,
  'Live Screen AI button is not wired to startLiveScreenMode().');
has(chat, /async function startLiveScreenMode\([\s\S]{0,5000}getDisplayMedia\([\s\S]{0,7000}drawImage\([\s\S]{0,2500}analyzeScreenFrame\(/,
  'Live Screen AI path does not capture fresh frames and call analyzeScreenFrame().');
has(chat, /const LIVE_FRAME_INTERVAL_MS = 6500/,
  'Live Screen AI request interval is not the expected bounded interval.');
has(chat, /renderAssistantResponse\(answer\)/,
  'Live Screen AI path does not render its analysis.');

// Trace both renderer calls through the preload bridge and main-process IPC
// handler into the vision-capable LLM service.
has(preload, /analyzeScreenFrame:\s*\(bytes, mimeType, instruction\)\s*=>\s*ipcRenderer\.invoke\('analyze-live-screen-frame'/,
  'Preload screen-frame bridge is missing or uses the wrong IPC channel.');
has(main, /ipcMain\.handle\("analyze-live-screen-frame"[\s\S]{0,1800}llmService\.analyzeScreenFrame\(image, mimeType, instruction\)/,
  'Main process IPC handler does not validate and forward the screen frame to the LLM service.');
has(llm, /async analyzeScreenFrame\([\s\S]{0,2200}inlineData:\s*\{\s*mimeType,\s*data:\s*imageBuffer\.toString\('base64'\)\s*\}[\s\S]{0,700}executeRequest\(request\)/,
  'LLM vision service does not send the captured image to Gemini.');

console.log('Screen AI UI route checks passed: buttons -> screen capture -> image frame -> preload IPC -> main IPC -> Gemini vision -> renderer response.');
