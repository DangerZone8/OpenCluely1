'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../api/gemini');

const envNames = [
  'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','GEMINI_API_KEY','GEMINI_API_KEYS',
  'GEMINI_API_KEY_2','GEMINI_API_KEY_3','GOOGLE_API_KEY','GOOGLE_GENAI_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY','SLICKLY_HOSTED_AI_PROVIDER','SLICKLY_PRO_HOSTED_AI_PROVIDER',
  'SLICKLY_QWENCLOUD_API_KEY','SLICKLY_QWENCLOUD_MODEL','SLICKLY_QWENCLOUD_BASE_URL',
  'SLICKLY_DEEPSEEK_API_KEY','SLICKLY_DEEPSEEK_MODEL','SLICKLY_MOONSHOT_API_KEY',
  'SLICKLY_MOONSHOT_MODEL','SLICKLY_MOONSHOT_BASE_URL'
];
const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
const originalFetch = global.fetch;

function makeResponse() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    write(value) { this.body += value; },
    end(value = '') { this.body += value; this.writableEnded = true; }
  };
}
async function invoke(feature, stream, providerFetch, plan = 'pro') {
  const installId = crypto.randomUUID();
  global.fetch = async (url, options = {}) => {
    if (String(url).endsWith('/auth/v1/user')) {
      assert.match(options.headers.Authorization, /^Bearer test-access-token$/);
      return { ok: true, json: async () => ({ id: '123e4567-e89b-42d3-a456-426614174000', email: 'pro@example.test' }) };
    }
    if (String(url).endsWith('/rest/v1/rpc/consume_slickly_credit_v2')) {
      const args = JSON.parse(options.body);
      assert.equal(args.p_pro_monthly_budget, 1000);
      return { ok: true, text: async () => JSON.stringify({
        allowed: true, used: 1, remaining: 19, daily_limit: 20,
        resets_at: '2026-12-01T00:00:00Z', plan,
        monthly_used: 1, monthly_remaining: 999, monthly_limit: 1000
      }) };
    }
    return providerFetch(url, options);
  };
  const res = makeResponse();
  await handler({
    method: 'POST',
    headers: {
      authorization: 'Bearer test-access-token',
      'content-length': '512',
      'x-opencluely-install-id': installId,
      'x-opencluely-feature': feature === 'screen-vision' ? 'screen-vision' : feature === 'voice' ? 'voice' : 'chat',
      ...(stream ? { 'x-opencluely-stream': '1' } : {})
    },
    body: { request: { contents: [{ role: 'user', parts: feature === 'screen-vision'
      ? [{ text: 'Describe the test image.' }, { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }]
      : feature === 'voice'
        ? [{ text: 'Briefly analyze this audio.' }, { inlineData: { mimeType: 'audio/wav', data: 'aGVsbG8=' } }]
        : [{ text: 'Reply with the short test phrase.' }] }] } }
  }, res);
  return res;
}

(async () => {
  for (const name of envNames) delete process.env[name];
  process.env.SUPABASE_URL = 'https://test-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.SLICKLY_PRO_HOSTED_AI_PROVIDER = 'qwencloud';
  process.env.SLICKLY_QWENCLOUD_API_KEY = 'test-qwen-key';
  process.env.SLICKLY_QWENCLOUD_MODEL = 'qwen3.8-max';
  let qwenCalls = 0;
  const qwen = await invoke('chat', true, async (url, options) => {
    qwenCalls += 1;
    assert.equal(url, 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer test-qwen-key');
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, 'qwen3.8-max');
    assert.match(payload.messages[0].content, /SECURITY BOUNDARY/);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'QWEN_HOSTED_OK' } }] }) };
  });
  assert.equal(qwen.statusCode, 200);
  assert.equal(qwen.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.match(qwen.body, /QWEN_HOSTED_OK/);
  assert.ok(qwen.body.includes('[DONE]'));
  assert.equal(qwenCalls, 1);

  process.env.SLICKLY_PRO_HOSTED_AI_PROVIDER = 'deepseek';
  process.env.SLICKLY_DEEPSEEK_API_KEY = 'test-deepseek-key';
  process.env.SLICKLY_DEEPSEEK_MODEL = 'deepseek-flash';
  const deepseek = await invoke('screen-vision', false, async (url, options) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer test-deepseek-key');
    const payload = JSON.parse(options.body);
    assert.equal(payload.model, 'deepseek-flash');
    const user = payload.messages.find(message => message.role === 'user');
    assert.ok(user.content.some(part => part.type === 'image_url'));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'DEEPSEEK_VISION_OK' } }] }) };
  });
  assert.equal(deepseek.statusCode, 200);
  assert.deepEqual(JSON.parse(deepseek.body), {
    text: 'DEEPSEEK_VISION_OK', model: 'deepseek-flash', provider: 'deepseek'
  });

  process.env.SLICKLY_PRO_HOSTED_AI_PROVIDER = 'kimi';
  process.env.SLICKLY_MOONSHOT_API_KEY = 'test-kimi-key';
  process.env.SLICKLY_MOONSHOT_MODEL = 'kimi-k3';
  const kimi = await invoke('chat', false, async (url, options) => {
    assert.equal(url, 'https://api.moonshot.ai/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer test-kimi-key');
    assert.equal(JSON.parse(options.body).model, 'kimi-k3');
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'KIMI_HOSTED_OK' } }] }) };
  });
  assert.equal(kimi.statusCode, 200);
  assert.equal(JSON.parse(kimi.body).provider, 'kimi');
  assert.equal(JSON.parse(kimi.body).text, 'KIMI_HOSTED_OK');

  // Raw audio is not accepted by the Qwen/DeepSeek/Kimi chat-completions APIs.
  // Pro voice must still work through Gemini after reserving its weighted credits.
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  process.env.SLICKLY_PRO_HOSTED_AI_PROVIDER = 'deepseek';
  process.env.SLICKLY_DEEPSEEK_API_KEY = 'test-deepseek-key';
  let geminiAudioCalls = 0;
  let deepseekAudioCalls = 0;
  const voice = await invoke('voice', false, async (url, options) => {
    const target = String(url);
    if (target.includes('generativelanguage.googleapis.com')) {
      geminiAudioCalls += 1;
      assert.equal(options.headers['x-goog-api-key'], 'test-gemini-key');
      const payload = JSON.parse(options.body);
      assert.ok(payload.contents[0].parts.some(part => part.inlineData?.mimeType === 'audio/wav'));
      return { ok: true, json: async () => ({
        candidates: [{ content: { parts: [{ text: 'VOICE_AUDIO_OK' }] } }],
        usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12, totalTokenCount: 52 }
      }) };
    }
    if (target.includes('/rest/v1/rpc/record_slickly_provider_usage')) {
      return { ok: true, text: async () => 'null' };
    }
    if (target.includes('api.deepseek.com')) deepseekAudioCalls += 1;
    throw new Error('Unexpected Pro voice provider request: ' + target);
  }, 'pro');
  assert.equal(voice.statusCode, 200);
  assert.equal(JSON.parse(voice.body).text, 'VOICE_AUDIO_OK');
  assert.match(JSON.parse(voice.body).model, /^gemini-/);
  assert.equal(geminiAudioCalls, 1);
  assert.equal(deepseekAudioCalls, 0);

  console.log('PASS: Pro-only QwenCloud, DeepSeek and Kimi routing, authenticated atomic 1,000-credit reservation, streaming, screen vision, Pro voice fallback, and server-only provider keys.');
})().catch(error => {
  console.error('HOSTED PROVIDER ROUTING TEST FAILED:', error);
  process.exitCode = 1;
}).finally(() => {
  global.fetch = originalFetch;
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
