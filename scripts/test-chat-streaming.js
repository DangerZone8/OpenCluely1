'use strict';

const assert = require('node:assert/strict');
const { Readable } = require('node:stream');

async function testDesktopStreamClient() {
  const llm = require('../src/services/llm.service');
  const originalFetch = global.fetch;
  const originalEndpoint = process.env.SLICKLY_E2E_AI_ENDPOINT;
  const originalRemoteOnly = llm.remoteOnly;
  const originalInitialized = llm.isInitialized;
  const originalInstallationId = llm.installationId;
  const originalAccountAccessTokenProvider = llm.accountAccessTokenProvider;
  const deltas = [];
  try {
    llm.remoteOnly = true;
    llm.isInitialized = true;
    llm.installationId = 'c9f26b40-3d45-4d1f-a6b5-7c12a3e4f501';
    llm.setAccountAccessTokenProvider(async () => 'stream-test-account-token');
    process.env.SLICKLY_E2E_AI_ENDPOINT = 'https://stream-test.example/api/gemini';
    global.fetch = async (_url, options) => {
      assert.equal(options.headers['x-opencluely-stream'], '1');
      const encoder = new TextEncoder();
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'text/event-stream; charset=utf-8' },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"text":"first"}\n'));
            controller.enqueue(encoder.encode('\ndata: {"text":" token"}\n\n'));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          }
        })
      };
    };
    const result = await llm.executeRemoteRequest({
      contents: [{ role: 'user', parts: [{ text: 'Stream a short reply.' }] }]
    }, 'gemini-3.1-flash-lite', (delta) => deltas.push(delta));
    assert.equal(result, 'first token');
    assert.deepEqual(deltas, ['first', ' token']);
  } finally {
    global.fetch = originalFetch;
    llm.remoteOnly = originalRemoteOnly;
    llm.isInitialized = originalInitialized;
    llm.installationId = originalInstallationId;
    llm.setAccountAccessTokenProvider(originalAccountAccessTokenProvider);
    if (originalEndpoint === undefined) delete process.env.SLICKLY_E2E_AI_ENDPOINT;
    else process.env.SLICKLY_E2E_AI_ENDPOINT = originalEndpoint;
  }
}

async function testHostedStreamingHandler() {
  const handler = require('../api/gemini');
  const originalFetch = global.fetch;
  const envNames = [
    'GEMINI_API_KEY', 'GEMINI_API_KEYS', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3',
    'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY',
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'
  ];
  const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  try {
    for (const name of envNames) delete process.env[name];
    process.env.GEMINI_API_KEY = 'stream-test-secret';
    process.env.SUPABASE_URL = 'https://stream-test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'stream-test-service-role-secret';
    global.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/auth/v1/user')) {
        assert.equal(options.headers.Authorization, 'Bearer stream-test-account-token');
        return { ok: true, json: async () => ({ id: '123e4567-e89b-42d3-a456-426614174000' }) };
      }
      if (target.endsWith('/rest/v1/rpc/consume_slickly_credit_v2')) {
        return { ok: true, text: async () => JSON.stringify({
          allowed: true, used: 1, remaining: 6, daily_limit: 7,
          resets_at: '2026-11-22T00:00:00Z', plan: 'free',
          monthly_used: 0, monthly_remaining: 0, monthly_limit: 0
        }) };
      }
      if (target.endsWith('/rest/v1/rpc/record_slickly_provider_usage')) {
        return { ok: true, text: async () => '[]' };
      }
      assert.match(target, /:streamGenerateContent\?alt=sse$/);
      return {
        ok: true,
        status: 200,
        body: Readable.from([
          Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n\n'),
          Buffer.from('data: {"candidates":[{"content":{"parts":[{"text":"there"}]}}]}\n\n')
        ])
      };
    };
    const response = {
      statusCode: 200,
      headers: {},
      body: '',
      destroyed: false,
      writableEnded: false,
      setHeader(name, value) { this.headers[name] = value; },
      write(chunk) { this.body += String(chunk); return true; },
      end(chunk) {
        if (chunk) this.body += String(chunk);
        this.writableEnded = true;
      }
    };
    await handler({
      method: 'POST',
      headers: {
        authorization: 'Bearer stream-test-account-token',
        'x-opencluely-install-id': '2f78a8d0-9913-4ab5-a2e3-cc3c02e5d601',
        'x-opencluely-stream': '1'
      },
      body: {
        request: {
          contents: [{ role: 'user', parts: [{ text: 'Say hello.' }] }],
          generationConfig: { maxOutputTokens: 64 }
        }
      }
    }, response);
    assert.equal(response.statusCode, 200);
    assert.match(response.headers['Content-Type'], /text\/event-stream/);
    assert.match(response.body, /"text":"Hello "/);
    assert.match(response.body, /"text":"there"/);
    assert.match(response.body, /\[DONE\]/);
  } finally {
    global.fetch = originalFetch;
    for (const name of envNames) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  }
}

(async () => {
  await testDesktopStreamClient();
  await testHostedStreamingHandler();
  console.log('PASS: hosted Gemini SSE streams through the API and reaches desktop chat incrementally.');
})().catch(error => {
  console.error('Hosted chat streaming test failed:', error);
  process.exitCode = 1;
});
