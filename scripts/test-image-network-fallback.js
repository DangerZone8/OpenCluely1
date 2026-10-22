'use strict';

const assert = require('node:assert/strict');
const llm = require('../src/services/llm.service');

async function main() {
  const saved = {
    remoteOnly: llm.remoteOnly,
    isInitialized: llm.isInitialized,
    model: llm.model,
    client: llm.client,
    executeRemoteRequest: llm.executeRemoteRequest,
    streamRequest: llm._streamRequestForModel,
    delay: llm.delay
  };
  let remoteCalls = 0;
  let directCalls = 0;
  const request = {
    contents: [{ role: 'user', parts: [
      { text: 'Describe this image.' },
      { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } }
    ] }],
    generationConfig: { maxOutputTokens: 32 }
  };

  try {
    llm.remoteOnly = false;
    llm.isInitialized = true;
    llm.model = 'gemini-3.5-flash-lite';
    llm.client = { models: { generateContent: async () => {
      directCalls++;
      throw new TypeError('fetch failed');
    } } };
    llm.delay = async () => {};
    llm.executeRemoteRequest = async payload => {
      remoteCalls++;
      assert.deepEqual(payload, request);
      return 'Hosted vision fallback response.';
    };

    const response = await llm.executeRequest(request);
    assert.equal(response, 'Hosted vision fallback response.');
    assert.ok(directCalls > 0, 'must attempt direct Gemini first');
    assert.equal(remoteCalls, 1, 'must use hosted proxy after direct network failure');

    directCalls = 0;
    remoteCalls = 0;
    llm._streamRequestForModel = async () => {
      directCalls++;
      throw new TypeError('fetch failed');
    };
    const deltas = [];
    const streamed = await llm.executeStreamingRequest(request, delta => deltas.push(delta));
    assert.equal(streamed, 'Hosted vision fallback response.');
    assert.ok(directCalls > 0, 'streaming must attempt direct Gemini first');
    assert.equal(remoteCalls, 1, 'streaming must use hosted proxy after direct network failure');
    assert.deepEqual(deltas, ['Hosted vision fallback response.']);

    console.log('PASS: image requests fall back to hosted vision proxy after direct Gemini fetch failures (streaming and non-streaming).');
  } finally {
    llm.remoteOnly = saved.remoteOnly;
    llm.isInitialized = saved.isInitialized;
    llm.model = saved.model;
    llm.client = saved.client;
    llm.executeRemoteRequest = saved.executeRemoteRequest;
    llm._streamRequestForModel = saved.streamRequest;
    llm.delay = saved.delay;
  }
}

main().catch(error => {
  console.error('IMAGE NETWORK FALLBACK TEST FAILED:', error);
  process.exitCode = 1;
});
