'use strict';

const assert = require('node:assert/strict');
const llmService = require('../src/services/llm.service');

function requireNaturalAnswer(text, label) {
  assert.equal(typeof text, 'string', label + ': response must be text');
  assert.ok(text.trim().length >= 8, label + ': response is empty or too short');
  assert.ok(!/\b(data structures and algorithms|DSA problem|array|binary tree)\b/i.test(text),
    label + ': casual chat incorrectly received a programming/DSA response: ' + text);
  assert.ok(!/\b(api key is properly configured|ensure your Gemini API key)\b/i.test(text),
    label + ': received a fallback instead of a real Gemini answer: ' + text);
}

async function main() {
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) is required for the live Gemini test. No mock response is used.');
  }
  if (!llmService.isInitialized) {
    throw new Error('Gemini client did not initialize. Check the API key and model configuration.');
  }

  const greeting = await llmService.processGeneralAssistantStream(
    'Ssup', [], null
  );
  assert.equal(greeting.metadata.usedFallback, false, 'Greeting must be answered by Gemini, not fallback');
  requireNaturalAnswer(greeting.response, 'Greeting');
  assert.ok(!/\b(algorithm|complexity|leetcode|data structure)\b/i.test(greeting.response),
    'Greeting should not be turned into a technical answer: ' + greeting.response);

  const first = await llmService.processGeneralAssistantStream(
    'For this test, option A costs $12 and option B costs $8. Which is cheaper?',
    [], null
  );
  assert.equal(first.metadata.usedFallback, false, 'First turn must be a real Gemini response');
  requireNaturalAnswer(first.response, 'First turn');
  assert.match(first.response, /option\s*B|\$8|8 dollars/i,
    'Gemini did not correctly answer the explicit comparison: ' + first.response);

  const followup = await llmService.processGeneralAssistantStream(
    'And how much cheaper is it?', [
      { role: 'user', content: 'For this test, option A costs $12 and option B costs $8. Which is cheaper?' },
      { role: 'model', content: first.response },
      { role: 'user', content: 'And how much cheaper is it?' }
    ], null
  );
  assert.equal(followup.metadata.usedFallback, false, 'Follow-up must be a real Gemini response');
  requireNaturalAnswer(followup.response, 'Follow-up');
  assert.match(followup.response, /\$?4|four dollars/i,
    'Gemini did not preserve context and calculate the $4 difference: ' + followup.response);

  console.log(JSON.stringify({
    status: 'PASS',
    provider: 'Gemini live API (not mocked)',
    tests: [
      { name: 'casual greeting', response: greeting.response },
      { name: 'explicit comparison', response: first.response },
      { name: 'contextual follow-up', response: followup.response }
    ]
  }, null, 2));
}

main().catch((error) => {
  console.error('LIVE GEMINI CHAT TEST FAILED:', error.message);
  process.exitCode = 1;
});
