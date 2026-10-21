'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const main = read('main.js');
const preload = read('preload.js');
const llm = read('src/services/llm.service.js');
const chat = read('chat.html');

assert.match(main, /setDisplayMediaRequestHandler/);
assert.match(main, /analyze-live-screen-frame/);
assert.match(preload, /analyzeScreenFrame:.*analyze-live-screen-frame/);
assert.match(llm, /async analyzeScreenFrame\(/);
assert.match(chat, /async function startLiveScreenMode\(/);
assert.match(chat, /async function askAIAboutScreen\(/);
assert.match(chat, /const LIVE_FRAME_INTERVAL_MS = 1500/);\nassert.match(chat, /liveScreenTimer = setTimeout\(sendFrame, LIVE_FRAME_INTERVAL_MS\)/);\nassert.match(chat, /if \(liveScreenFrameInFlight\)/);\nassert.match(chat, /streamAtStart/);
assert.match(chat, /Live screen AI is on/);
assert.match(chat, /no video file is being saved/);
assert.match(main, /desktopCapturer\.getSources/);
assert.match(main, /capture\.audio = "loopback"/);
assert.match(main, /analyze-captured-audio/);
assert.match(preload, /analyzeCapturedAudio:.*analyze-captured-audio/);
assert.match(llm, /async processAudioWithGemini/);
assert.match(llm, /inlineData: \{ mimeType, data: audioBuffer\.toString\('base64'\) \}/);
assert.match(chat, /async function convertAudioBlobToWav/);
assert.match(chat, /analyzeCapturedAudio\(bytes, 'audio\/wav'\)/);
assert.match(chat, /function applyMicVisibility\(\)[\s\S]*?micButton\.style\.display = ''/);
assert.match(chat, /function startBuiltInAudioCapture/);
assert.match(chat, /Live listening to /);
assert.match(chat, /scheduleAudioSegmentRotation\(stream, sourceLabel\)/);
assert.match(chat, /}, 6000\)/);
assert.match(chat, /queueAudioAnalysis\(blob, sourceLabel\)/);

let inlineScripts = 0;
for (const match of chat.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
  if (!match[1].trim()) continue;
  new vm.Script(match[1], { filename: 'chat.html inline script ' + (++inlineScripts) });
}
assert.ok(inlineScripts > 0, 'chat.html inline JavaScript should be syntax-checked');
console.log('Built-in audio and screen-capture contract checks passed; parsed ' + inlineScripts + ' inline chat script(s).');
