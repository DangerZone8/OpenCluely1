'use strict';

const assert = require('node:assert/strict');

async function testHostedClient() {
  const llm = require('../src/services/llm.service');
  const originalFetch = global.fetch;
  const originalEndpoint = llm.remoteEndpoint;
  const originalRemoteOnly = llm.remoteOnly;
  const originalInitialized = llm.isInitialized;
  const originalClient = llm.client;
  const originalStrictEndpoint = process.env.SLICKLY_E2E_AI_ENDPOINT;
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
        text: async () => JSON.stringify({ text: 'Hosted AI response works.' })
      };
    };

    const request = {
      contents: [{ role: 'user', parts: [{ text: 'Say hello.' }] }],
      generationConfig: { maxOutputTokens: 32 }
    };
    const response = await llm.executeRequest(request);
    assert.equal(response, 'Hosted AI response works.');
    assert.equal(seen.url, 'https://slicklyai.vercel.app/api/gemini',
      'hosted client must try the Slickly AI production endpoint before legacy aliases');
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
    assert.match(seen.body.request.contents[0].parts[0].text, /Listen to (?:this audio|the complete audio clip)/);

    // A provider quota exhaustion on the production alias should not prevent
    // trying an independent backup deployment. App-level 429s remain terminal.
    delete process.env.SLICKLY_E2E_AI_ENDPOINT;
    const fallbackCalls = [];
    global.fetch = async (url) => {
      fallbackCalls.push(String(url));
      if (String(url).includes('slicklyai.vercel.app')) {
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({
            error: 'Gemini usage limit reached.',
            providerCode: 'RESOURCE_EXHAUSTED',
            providerStatus: 429
          })
        };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ text: 'Backup deployment response.' }) };
    };
    const fallbackResponse = await llm.executeRequest(request);
    assert.equal(fallbackResponse, 'Backup deployment response.');
    assert.deepEqual(fallbackCalls, [
      'https://slicklyai.vercel.app/api/gemini',
      'https://cleverly-lime.vercel.app/api/gemini'
    ]);
    console.log('PASS: provider quota exhaustion fails over once to an independent hosted deployment.');

    console.log('PASS: keyless hosted AI supports chat, screen vision, and audio analysis without exposing a Gemini key.');
  } finally {
    global.fetch = originalFetch;
    llm.remoteEndpoint = originalEndpoint;
    llm.remoteOnly = originalRemoteOnly;
    llm.isInitialized = originalInitialized;
    llm.client = originalClient;
    if (originalStrictEndpoint === undefined) delete process.env.SLICKLY_E2E_AI_ENDPOINT;
    else process.env.SLICKLY_E2E_AI_ENDPOINT = originalStrictEndpoint;
  }
}

async function testProxyHandler() {
  const handler = require('../api/gemini');
  const originalKey = process.env.GEMINI_API_KEY;
  const originalKey2 = process.env.GEMINI_API_KEY_2;
  const originalKeys = process.env.GEMINI_API_KEYS;
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
    delete process.env.GEMINI_API_KEY_2;
    delete process.env.GEMINI_API_KEYS;
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
      body: { model: 'gemini-3-flash-preview', request: { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] } }
    }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).text, 'Proxy response.');

    // An exhausted provider project must fail over to a separately quota-managed
    // server-side key rather than stopping chat and screen vision immediately.
    process.env.GEMINI_API_KEY_2 = 'backup-server-secret-not-a-real-key';
    const keyAttempts = [];
    global.fetch = async (url, options) => {
      keyAttempts.push({ model: decodeURIComponent(String(url).split('/models/')[1].split(':')[0]), key: options.headers['x-goog-api-key'] });
      if (options.headers['x-goog-api-key'] === 'test-server-secret-not-a-real-key') {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota exhausted' } })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ text: 'Backup key response.' }] } }] })
      };
    };
    response = makeResponse();
    await handler({
      method: 'POST',
      headers: {
        'content-length': '150',
        'x-opencluely-install-id': '3f78a8d0-9913-4ab5-a2e3-cc3c02e5d601',
        'x-forwarded-for': '198.51.100.43'
      },
      body: { model: 'gemini-3.1-flash-lite', request: { contents: [{ role: 'user', parts: [{ text: 'hello' }] }] } }
    }, response);
    assert.equal(response.statusCode, 200, 'quota exhaustion on primary key should fail over');
    assert.equal(JSON.parse(response.body).text, 'Backup key response.');
    assert.equal(keyAttempts.length, 2, 'failover should make one bounded backup attempt');
    assert.deepEqual(keyAttempts.map(attempt => attempt.model), ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite'], 'key failover must stay on Gemini 3 only');
    assert.equal(keyAttempts[1].key, 'backup-server-secret-not-a-real-key');
    console.log('PASS: provider quota exhaustion fails over to a backup Gemini key without exposing secrets.');
    console.log('PASS: hosted Gemini proxy keeps its secret server-side and validates keyless requests.');
  } finally {
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
    if (originalKey2 === undefined) delete process.env.GEMINI_API_KEY_2;
    else process.env.GEMINI_API_KEY_2 = originalKey2;
    if (originalKeys === undefined) delete process.env.GEMINI_API_KEYS;
    else process.env.GEMINI_API_KEYS = originalKeys;
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
