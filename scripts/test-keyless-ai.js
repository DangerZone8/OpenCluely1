'use strict';

const assert = require('node:assert/strict');

async function testHostedClient() {
  const llm = require('../src/services/llm.service');
  const originalFetch = global.fetch;
  const originalEndpoint = llm.remoteEndpoint;
  const originalRemoteOnly = llm.remoteOnly;
  const originalInitialized = llm.isInitialized;
  const originalClient = llm.client;
  const installId = 'a9d32e1c-8f42-4e65-a4ef-91d46f3f4b82';
  let seen;
  try {
    llm.remoteOnly = true;
    llm.isInitialized = true;
    llm.client = null;
    llm.remoteEndpoint = 'https://opencluely-iota.vercel.app/api/gemini';
    llm.installationId = installId;
    global.fetch = async (url, options) => {
      seen = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        status: 200,
        json: async () => ({ text: 'Hosted AI response works.' })
      };
    };

    const request = {
      contents: [{ role: 'user', parts: [{ text: 'Say hello.' }] }],
      generationConfig: { maxOutputTokens: 32 }
    };
    const response = await llm.executeRequest(request);
    assert.equal(response, 'Hosted AI response works.');
    assert.equal(seen.url, llm.remoteEndpoint);
    assert.equal(seen.options.headers['x-opencluely-install-id'], installId);
    assert.equal(seen.body.model, llm.model);
    assert.deepEqual(seen.body.request, request);
    assert.equal(Object.hasOwn(seen.options.headers, 'x-goog-api-key'), false,
      'Desktop must never send a provider key to the hosted proxy');

    const frame = Buffer.from('fake jpeg bytes');
    const screen = await llm.analyzeScreenFrame(frame, 'image/jpeg', 'Look at this');
    assert.equal(screen.response, 'Hosted AI response works.');
    assert.match(seen.body.request.contents[0].parts[0].text, /Look at this/);

    const audio = await llm.processAudioWithGemini(Buffer.from('fake webm bytes'), 'audio/webm');
    assert.equal(audio.response, 'Hosted AI response works.');
    assert.match(seen.body.request.contents[0].parts[0].text, /Listen to this audio/);

    console.log('PASS: keyless hosted AI supports chat, screen vision, and audio analysis without exposing a Gemini key.');
  } finally {
    global.fetch = originalFetch;
    llm.remoteEndpoint = originalEndpoint;
    llm.remoteOnly = originalRemoteOnly;
    llm.isInitialized = originalInitialized;
    llm.client = originalClient;
  }
}

async function testProxyHandler() {
  const handler = require('../api/gemini');
  const originalKey = process.env.GEMINI_API_KEY;
  const originalGoogleKey = process.env.GOOGLE_API_KEY;
  const originalFetch = global.fetch;
  const installId = '2f78a8d0-9913-4ab5-a2e3-cc3c02e5d601';

  function makeResponse() {
    return {
      statusCode: 200,
      headers: {},
      body: '',
      setHeader(name, value) { this.headers[name] = value; },
      end(body) { this.body = body; }
    };
  }

  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    let response = makeResponse();
    await handler({ method: 'POST', headers: {}, body: {} }, response);
    assert.equal(response.statusCode, 503, 'Proxy must fail closed when server secret is not configured');

    process.env.GEMINI_API_KEY = 'test-server-secret-not-a-real-key';
    global.fetch = async (url, options) => {
      assert.match(url, /generativelanguage\.googleapis\.com/);
      assert.equal(options.headers['x-goog-api-key'], 'test-server-secret-not-a-real-key');
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'Proxy response.' }] } }] })
      };
    };
    response = makeResponse();
    await handler({
      method: 'POST',
      headers: {
        'content-length': '150',
        'x-opencluely-install-id': installId,
        'x-forwarded-for': '198.51.100.42'
      },
      body: { model: 'gemini-3.1-flash-lite', request: { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] } }
    }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).text, 'Proxy response.');
    console.log('PASS: hosted Gemini proxy keeps its secret server-side and validates keyless requests.');
  } finally {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = originalGoogleKey;
    global.fetch = originalFetch;
  }
}

(async () => {
  await testHostedClient();
  await testProxyHandler();
})().catch(error => {
  console.error('KEYLESS AI TEST FAILED:', error);
  process.exitCode = 1;
});
