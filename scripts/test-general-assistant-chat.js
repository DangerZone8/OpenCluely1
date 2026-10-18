'use strict';

const assert = require('node:assert/strict');
const llmService = require('../src/services/llm.service');

async function run() {
  llmService.isInitialized = true;
  let capturedRequest;
  let emitted = '';
  llmService.executeStreamingRequest = async (request, onDelta) => {
    capturedRequest = request;
    onDelta('Hey there!');
    return 'Hey there! How can I help?';
  };

  const result = await llmService.processGeneralAssistantStream(
    'What about the second option?',
    [
      { role: 'user', content: 'Which option is cheaper?' },
      { role: 'model', content: 'Option B is cheaper.' },
      { role: 'user', content: 'What about the second option?' }
    ],
    (delta) => { emitted += delta; }
  );

  assert.equal(result.response, 'Hey there! How can I help?');
  assert.equal(emitted, 'Hey there!');
  assert.equal(capturedRequest.contents.length, 3, 'Recent conversation should be passed to Gemini');
  assert.equal(capturedRequest.contents[1].role, 'model');
  assert.equal(capturedRequest.contents[1].parts[0].text, 'Option B is cheaper.');
  assert.match(capturedRequest.systemInstruction.parts[0].text, /Respond naturally/);
  assert.match(capturedRequest.systemInstruction.parts[0].text, /conversation history/);
  console.log('General assistant chat context and streaming test passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
