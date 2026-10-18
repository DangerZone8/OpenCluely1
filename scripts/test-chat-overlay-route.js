'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const htmlFiles = ['index.html', 'chat.html', 'overlay.html']
  .map((file) => path.join(root, file))
  .filter((file) => fs.existsSync(file));
const renderers = htmlFiles.map((file) => ({ file: path.basename(file), text: fs.readFileSync(file, 'utf8') }));
const allRendererText = renderers.map((item) => item.text).join('\n');

function requireMatch(text, regex, message) {
  assert.match(text, regex, message);
}

// Trace typed-chat request from renderer/preload IPC to the main-process general assistant route.
requireMatch(preload, /sendMessage|process.*chat|chat.*message/i,
  'Preload must expose a chat message bridge.');
requireMatch(main, /generalAssistant\s*:\s*true/,
  'Main process must route typed chat through the general-assistant path.');
requireMatch(main, /processWithLLM\s*\(/,
  'Main process must invoke the LLM service for chat.');
requireMatch(main, /processGeneralAssistantStream|generalAssistant/,
  'Main process must select the general assistant handler.');
requireMatch(main, /transcription-received/,
  'Main process must deliver response/transcription events to renderer windows.');
requireMatch(preload, /transcription-received/,
  'Preload must relay response events from main process.');
assert.ok(renderers.length > 0, 'Could not find a renderer HTML file to trace chat UI.');
requireMatch(allRendererText, /transcription-received/,
  'Renderer must subscribe to the response event.');
requireMatch(allRendererText, /sendMessage|process.*chat|chat.*message/i,
  'Renderer must have a chat send path.');

console.log('Chat overlay route trace passed: renderer -> preload IPC -> main general-assistant route -> LLM -> response event -> renderer.');
