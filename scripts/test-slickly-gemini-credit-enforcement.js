'use strict';

const assert = require('node:assert/strict');
const handler = require('../api/gemini');

function response() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body || ''; }
  };
}

function request(installId, authorization, feature, parts) {
  return {
    method: 'POST',
    headers: {
      'x-opencluely-install-id': installId,
      ...(authorization ? { authorization } : {}),
      ...(parts.some(part => part.inlineData || part.fileData) ? { 'x-opencluely-feature': 'screen-vision' } : {})
    },
    body: { feature, request: { contents: [{ role: 'user', parts }] } }
  };
}

async function run() {
  const envNames = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY', 'SLICKLY_HOSTED_AI_PROVIDER'];
  const saved = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
  const oldFetch = global.fetch;
  const calls = { auth: 0, rpc: 0, provider: 0, args: null };
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-secret';
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    process.env.SLICKLY_HOSTED_AI_PROVIDER = 'gemini';
    global.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/auth/v1/user')) {
        calls.auth += 1;
        assert.match(options.headers.Authorization, /^Bearer valid-access-token$/);
        return { ok: true, json: async () => ({ id: '123e4567-e89b-42d3-a456-426614174000' }) };
      }
      if (String(url).includes('/rest/v1/rpc/consume_slickly_credit_v2')) {
        calls.rpc += 1;
        calls.args = JSON.parse(options.body);
        return { ok: true, text: async () => JSON.stringify([{
          allowed: false, used: 499, remaining: 1, daily_limit: 10,
          resets_at: '2026-12-01T00:00:00Z', plan: 'pro',
          monthly_used: 499, monthly_remaining: 1, monthly_limit: 500,
          limit_reason: 'monthly_budget'
        }]) };
      }
      calls.provider += 1;
      throw new Error('Provider must not be called after a denied credit reservation.');
    };

    const unauthenticated = response();
    await handler(request('123e4567-e89b-42d3-a456-426614174001', null, 'chat', [{ text: 'hello' }]), unauthenticated);
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(calls.rpc, 0, 'unauthenticated requests must not reserve credits');
    assert.equal(calls.provider, 0, 'unauthenticated requests must not reach the provider');

    const exhausted = response();
    await handler(request('123e4567-e89b-42d3-a456-426614174002', 'Bearer valid-access-token', 'screen_aware', [
      { inlineData: { mimeType: 'image/jpeg', data: 'dGVzdA==' } }
    ]), exhausted);
    assert.equal(exhausted.statusCode, 429);
    const body = JSON.parse(exhausted.body);
    assert.equal(body.code, 'MONTHLY_BUDGET_EXHAUSTED');
    assert.equal(body.monthly.remaining, 1);
    assert.equal(calls.rpc, 1);
    assert.equal(calls.args.p_feature, 'screen_aware');
    assert.equal(calls.args.p_feature_units, 3, 'all image requests use the higher server-enforced multimodal weight');
    assert.equal(calls.args.p_pro_monthly_budget, 500);
    assert.equal(calls.provider, 0, 'the provider must not be called when the monthly allowance is exhausted');

    // Audio requests use the higher multimodal weight and preserve enough output
    // budget for transcription, rather than being clipped to the chat limit.
    global.fetch = async (url, options = {}) => {
      if (String(url).endsWith('/auth/v1/user')) {
        return { ok: true, json: async () => ({ id: '123e4567-e89b-42d3-a456-426614174000' }) };
      }
      if (String(url).includes('/rest/v1/rpc/consume_slickly_credit_v2')) {
        calls.args = JSON.parse(options.body);
        return { ok: true, text: async () => JSON.stringify([{
          allowed: false, used: 2, remaining: 0, daily_limit: 2,
          resets_at: '2026-12-01T00:00:00Z', plan: 'free',
          monthly_used: 0, monthly_remaining: 0, monthly_limit: 0,
          limit_reason: 'daily_limit'
        }]) };
      }
      throw new Error('Provider must not be called after a denied voice reservation.');
    };
    const voiceRequest = request('123e4567-e89b-42d3-a456-426614174003', 'Bearer valid-access-token', 'voice', [
      { inlineData: { mimeType: 'audio/webm', data: 'dGVzdA==' } }
    ]);
    voiceRequest.body.request.generationConfig = { maxOutputTokens: 9000 };
    const voiceDenied = response();
    await handler(voiceRequest, voiceDenied);
    assert.equal(voiceDenied.statusCode, 429);
    assert.equal(calls.args.p_feature, 'voice');
    assert.equal(calls.args.p_feature_units, 4);
    assert.equal(voiceRequest.body.request.generationConfig.maxOutputTokens, 2048);

    // Successful hosted chat records provider-reported usage without storing
    // request text or media in the telemetry row.
    let usageArgs = null;
    global.fetch = async (url, options = {}) => {
      const target = String(url);
      if (target.endsWith('/auth/v1/user')) {
        return { ok: true, json: async () => ({ id: '123e4567-e89b-42d3-a456-426614174000' }) };
      }
      if (target.includes('/rest/v1/rpc/consume_slickly_credit_v2')) {
        calls.args = JSON.parse(options.body);
        return { ok: true, text: async () => JSON.stringify([{
          allowed: true, used: 1, remaining: 6, daily_limit: 7,
          resets_at: '2026-12-01T00:00:00Z', plan: 'free',
          monthly_used: 0, monthly_remaining: 0, monthly_limit: 0
        }]) };
      }
      if (target.includes('generativelanguage.googleapis.com')) {
        calls.provider += 1;
        return { ok: true, json: async () => ({
          candidates: [{ content: { parts: [{ text: 'Slickly test response' }] } }],
          usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 45, totalTokenCount: 165 }
        }) };
      }
      if (target.includes('/rest/v1/rpc/record_slickly_provider_usage')) {
        usageArgs = JSON.parse(options.body);
        return { ok: true, text: async () => 'null' };
      }
      throw new Error('Unexpected test fetch ' + target);
    };
    const successRequest = request('123e4567-e89b-42d3-a456-426614174004', 'Bearer valid-access-token', 'chat', [{ text: 'hello' }]);
    successRequest.body.request.generationConfig = { maxOutputTokens: 5000 };
    const success = response();
    await handler(successRequest, success);
    assert.equal(success.statusCode, 200);
    assert.equal(JSON.parse(success.body).text, 'Slickly test response');
    assert.equal(successRequest.body.request.generationConfig.maxOutputTokens, 512);
    assert.equal(calls.provider, 1);
    assert.equal(usageArgs.p_user_id, '123e4567-e89b-42d3-a456-426614174000');
    assert.equal(usageArgs.p_feature, 'chat');
    assert.equal(usageArgs.p_provider, 'gemini');
    assert.equal(usageArgs.p_prompt_tokens, 120);
    assert.equal(usageArgs.p_output_tokens, 45);
    assert.equal(usageArgs.p_total_tokens, 165);
    assert.equal(JSON.stringify(usageArgs).includes('hello'), false);

    console.log('PASS: hosted Gemini requires Supabase auth, reserves weighted credits before provider access, preserves voice output limits and records privacy-minimised provider usage.');

  } finally {
    global.fetch = oldFetch;
    for (const name of envNames) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
