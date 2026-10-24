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

  console.log(JSON.stringify({
    status: 'PASS',
    provider: 'Live Gemini through hosted Cleverly AI proxy (not mocked)',
    providerRequests: 1,
    response
  }, null, 2));
}

main().catch((error) => {
  console.error('LIVE GEMINI CHAT TEST FAILED:', error.message);
  process.exitCode = 1;
});
