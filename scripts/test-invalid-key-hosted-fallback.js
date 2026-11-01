'use strict';

const assert = require('node:assert/strict');
const llmService = require('../src/services/llm.service');

async function main() {
  const previous = {
    apiKey: process.env.GEMINI_API_KEY,
    provider: process.env.AI_PROVIDER,
    remoteOnly: llmService.remoteOnly,
    model: llmService.model,
    stream: llmService._streamRequestForModel,
    remote: llmService.executeRemoteRequest
  };
  try {
    process.env.AI_PROVIDER = 'gemini';
    process.env.GEMINI_API_KEY = 'deliberately-invalid-test-key';
    llmService.remoteOnly = false;
    llmService.model = 'gemini-3.1-flash-lite';

    const invalidKeyError = new Error('HTTP 400: {"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}');
    assert.equal(llmService.analyzeError(invalidKeyError).type, 'AUTH_ERROR',
      'Google API_KEY_INVALID / INVALID_ARGUMENT responses must be classified as authentication errors');

    let directCalls = 0;
    let hostedCalls = 0;
    const deltas = [];
    llmService._streamRequestForModel = async () => {
      directCalls += 1;
      throw invalidKeyError;
    };
    llmService.executeRemoteRequest = async request => {
      hostedCalls += 1;
      assert.ok(request.contents?.length, 'the original conversation context must be preserved');
      return 'HOSTED_INVALID_KEY_FALLBACK_OK';
    };

    const result = await llmService.executeStreamingRequest({
      contents: [{ role: 'user', parts: [{ text: 'Is Descript free? And its competitors?' }] }]
    }, delta => deltas.push(delta));

    assert.equal(result, 'HOSTED_INVALID_KEY_FALLBACK_OK');
    assert.equal(directCalls, 1, 'do not waste retries on a definitively invalid key');
    assert.equal(hostedCalls, 1, 'retry through the managed hosted endpoint exactly once');
    assert.deepEqual(deltas, ['HOSTED_INVALID_KEY_FALLBACK_OK']);
    console.log('PASS: invalid local Gemini key is detected and chat falls back to hosted Slickly AI without losing request context.');
  } finally {
    llmService._streamRequestForModel = previous.stream;
    llmService.executeRemoteRequest = previous.remote;
    llmService.remoteOnly = previous.remoteOnly;
    llmService.model = previous.model;
    if (previous.apiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous.apiKey;
    if (previous.provider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previous.provider;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
