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
    delay: llm.delay,
    remoteEndpoint: llm.remoteEndpoint,
    fetch: global.fetch,
    fallbackEndpointEnv: process.env.OPENCLUELY_AI_FALLBACK_ENDPOINT
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

    // Regression: a reachable but misconfigured Vercel alias returns HTTP 503.
    // The app must try the next hosted alias instead of stopping at the first response.
    llm.executeRemoteRequest = saved.executeRemoteRequest;
    llm.remoteEndpoint = 'https://misconfigured.example/api/gemini';
    process.env.OPENCLUELY_AI_FALLBACK_ENDPOINT = 'https://healthy.example/api/gemini';
    const originalFetch = global.fetch;
    const endpointCalls = [];
    global.fetch = async (url) => {
      endpointCalls.push(String(url));
      if (String(url).includes('misconfigured.example')) {
        return {
          status: 503,
          headers: { get: () => 'quota-guard-2026-10-22-a' },
          text: async () => JSON.stringify({ error: 'not configured' })
        };
      }
      if (String(url).includes('healthy.example')) {
        return {
          status: 200,
          headers: { get: () => 'quota-guard-2026-10-22-a' },
          text: async () => JSON.stringify({ text: 'Fallback host works.' })
        };
      }
      throw new Error('Unexpected endpoint reached in test: ' + String(url));
    };
    try {
      const hostedResponse = await llm.executeRemoteRequest({
        contents: [{ role: 'user', parts: [{ text: 'Reply OK.' }] }]
      });
      assert.equal(hostedResponse, 'Fallback host works.');
      assert.deepEqual(endpointCalls, [
        'https://misconfigured.example/api/gemini',
        'https://healthy.example/api/gemini'
      ]);
    } finally {
      global.fetch = originalFetch;
    }

    console.log('PASS: hosted AI falls back to a healthy alias after a misconfigured alias returns HTTP 503.');
    console.log('PASS: image requests fall back to hosted vision proxy after direct Gemini fetch failures (streaming and non-streaming).');
  } finally {
    llm.remoteOnly = saved.remoteOnly;
    llm.isInitialized = saved.isInitialized;
    llm.model = saved.model;
    llm.client = saved.client;
    llm.executeRemoteRequest = saved.executeRemoteRequest;
    llm._streamRequestForModel = saved.streamRequest;
    llm.delay = saved.delay;
    llm.remoteEndpoint = saved.remoteEndpoint;
    global.fetch = saved.fetch;
    if (saved.fallbackEndpointEnv === undefined) delete process.env.OPENCLUELY_AI_FALLBACK_ENDPOINT;
    else process.env.OPENCLUELY_AI_FALLBACK_ENDPOINT = saved.fallbackEndpointEnv;
  }
}

main().catch(error => {
  console.error('IMAGE NETWORK FALLBACK TEST FAILED:', error);
  process.exitCode = 1;
});
