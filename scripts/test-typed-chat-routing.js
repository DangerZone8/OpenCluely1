'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

const handlerStart = main.indexOf('ipcMain.handle("send-chat-message"');
assert.notEqual(handlerStart, -1, 'typed-chat IPC handler must exist');
const handlerEnd = main.indexOf('ipcMain.handle("get-skill-prompt"', handlerStart);
assert.notEqual(handlerEnd, -1, 'typed-chat IPC handler must have a clear boundary');
const handler = main.slice(handlerStart, handlerEnd);
assert.match(handler, /await this\.processWithLLM\(/, 'IPC must await actual chat processing');
assert.doesNotMatch(handler, /\(async \(\) =>/, 'IPC must not fire-and-forget and report success early');
assert.match(handler, /return \{ success: false, error:/, 'IPC must report failures instead of silently swallowing them');

const processStart = main.indexOf('async processWithLLM(');
assert.notEqual(processStart, -1, 'typed-chat processing method must exist');
const processEnd = main.indexOf('\n  /**\n   * Buffer a transcribed fragment', processStart);
assert.notEqual(processEnd, -1, 'typed-chat processing method must have a clear boundary');
const processMethod = main.slice(processStart, processEnd);
assert.match(processMethod, /await llmService\.processGeneralAssistantStream\(/,
  'typed chat must use the general assistant regardless of selected skill');
assert.doesNotMatch(processMethod, /await llmService\.processTextWithSkillStream\(/,
  'typed chat must not inherit the selected skill prompt');
assert.match(processMethod, /return \{ success: true, response: llmResult\.response/,
  'successful typed chat must return its actual response');
assert.match(processMethod, /return \{ success: false, error:/,
  'failed typed chat must return a failure result');

console.log('PASS: typed-chat IPC awaits completion, uses the general assistant, and returns real success/failure results.');
