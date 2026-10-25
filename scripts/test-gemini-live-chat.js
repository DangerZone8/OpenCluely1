'use strict';

const assert = require('node:assert/strict');
const llmService = require('../src/services/llm.service');

async function main() {
  // Exercise the same hosted Gemini proxy used by keyless desktop screen/audio
  // flows. This is a real provider-backed request, not a mock, but deliberately
  // uses one provider call so CI does not burn a multi-turn quota budget on every push.
  const prompt = 'Reply with exactly LIVE_GEMINI_CHAT_OK and no other text.';
  const response = await llmService.executeRemoteRequest({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 24 }
  });

  assert.equal(typeof response, 'string', 'Hosted Gemini chat must return text');
  assert.match(response, /LIVE_GEMINI_CHAT_OK/i,
    'Hosted Gemini chat did not return the requested confirmation: ' + response);

  // Exercise the actual general-assistant prompt/history path through the
  // hosted provider, not just a raw marker request with no system instruction.
  const previousRemoteOnly = llmService.remoteOnly;
  llmService.remoteOnly = true;
  let greeting;
  try {
    greeting = await llmService.processGeneralAssistantStream('hi', []);
  } finally {
    llmService.remoteOnly = previousRemoteOnly;
  }
  assert.equal(typeof greeting.response, 'string', 'General assistant must return a real greeting');
  assert.ok(greeting.response.trim().length > 0, 'General assistant greeting must not be empty');
  assert.match(greeting.response, /\\b(hi|hello|hey|help|assist)\\b/i,
    'A plain greeting should receive a conversational reply: ' + greeting.response);
  assert.doesNotMatch(greeting.response, /data structures and algorithms|algorithm or data structure|consider breaking it down into smaller components/i,
    'A plain greeting must not receive the canned DSA answer: ' + greeting.response);

  console.log(JSON.stringify({
    status: 'PASS',
    provider: 'Live Gemini through hosted Cleverly AI proxy (not mocked)',
    providerRequests: 1,
    response,
    generalGreeting: greeting.response
  }, null, 2));
}

main().catch((error) => {
  console.error('LIVE GEMINI CHAT TEST FAILED:', error.message);
  process.exitCode = 1;
});
