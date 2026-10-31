'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Git checkout may materialize CRLF on Windows; normalize before matching source boundaries.
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').replace(/\r\n/g, '\n');

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

const speechStart = main.indexOf('async processTranscriptionWithLLM(text, sessionHistory)');
assert.notEqual(speechStart, -1, 'spoken-chat processing method must exist');
const speechEnd = main.indexOf('broadcastOCRSuccess(ocrResult)', speechStart);
assert.notEqual(speechEnd, -1, 'spoken-chat processing method must have a clear boundary');
const speechMethod = main.slice(speechStart, speechEnd);
assert.ok(speechMethod.includes('await llmService.processGeneralAssistantStream('),
  'spoken chat must use the general assistant instead of the skill-only filter prompt');
assert.ok(!speechMethod.includes('processTranscriptionWithIntelligentResponseStream('),
  'ordinary spoken chat must not be routed through the skill-only prompt');
assert.ok(speechMethod.includes("I couldn't reach the AI service just now"),
  'network failures must not be disguised as canned DSA answers');

console.log('PASS: typed and spoken chat use the general assistant; failures are transparent.');


const chatUi = fs.readFileSync(path.join(__dirname, '..', 'chat.html'), 'utf8').replace(/\\r\\n/g, '\\n');
const submitStart = chatUi.indexOf('async function submitChatMessage()');
assert.notEqual(submitStart, -1, 'chat renderer must have one shared typed-message submission function');
const submitEnd = chatUi.indexOf('if (sendButton)', submitStart);
const submitMethod = chatUi.slice(submitStart, submitEnd);
assert.match(submitMethod, /await whysperAPI\\.sendChatMessage\\(/, 'typed chat must await the IPC result');
assert.match(submitMethod, /result\\.success !== true/, 'typed chat must detect IPC failures');
assert.match(submitMethod, /renderAssistantResponse\\(result\\.response\\)/, 'typed chat must render the returned answer in the chat window');
assert.match(submitMethod, /hideThinkingIndicator\\(\\)/, 'typed chat must clear the thinking indicator on success and failure');
assert.match(submitMethod, /addMessage\\('Could not get an answer:/, 'typed chat must show actionable request errors');
assert.match(chatUi, /sendButton\\.addEventListener\\('click', submitChatMessage\\)/, 'Send button must use the shared submission function');
assert.match(chatUi, /submitChatMessage\\(\\);/, 'Enter key must use the shared submission function');
