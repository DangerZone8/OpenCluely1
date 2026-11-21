'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../api/gemini');

const envNames = [
  'GEMINI_API_KEY','GEMINI_API_KEYS','GEMINI_API_KEY_2','GEMINI_API_KEY_3',
  'GOOGLE_API_KEY','GOOGLE_GENAI_API_KEY','GOOGLE_GENERATIVE_AI_API_KEY',
  'SLICKLY_HOSTED_AI_PROVIDER','SLICKLY_QWENCLOUD_API_KEY','SLICKLY_QWENCLOUD_MODEL',
  'SLICKLY_QWENCLOUD_BASE_URL','SLICKLY_DEEPSEEK_API_KEY','SLICKLY_DEEPSEEK_MODEL',
  'SLICKLY_MOONSHOT_API_KEY','SLICKLY_MOONSHOT_MODEL','SLICKLY_MOONSHOT_BASE_URL'
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
async function invoke(feature, stream, fetchImpl) {
  global.fetch = fetchImpl;
  const res = makeResponse();
  const installId = crypto.randomUUID();
  await handler({
    method: 'POST',
    headers: {
      'content-length': '512',
      'x-opencluely-install-id': installId,
      'x-opencluely-feature': feature === 'screen-vision' ? 'screen-vision' : 'chat',
      ...(stream ? { 'x-opencluely-stream': '1' } : {})
    },
    body: { request: { contents: [{ role: 'user', parts: feature === 'screen-vision'
      ? [{ text: 'Describe the test image.' }, { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }]
      : [{ text: 'Reply with the short test phrase.' }] }] } }
  }, res);
  return res;
}

(async () => {
  for (const name of envNames) delete process.env[name];

  process.env.SLICKLY_HOSTED_AI_PROVIDER = 'qwencloud';
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
  assert.match(qwen.body, /\[DONE\]/);
  assert.equal(qwenCalls, 1);

  process.env.SLICKLY_HOSTED_AI_PROVIDER = 'deepseek';
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

  process.env.SLICKLY_HOSTED_AI_PROVIDER = 'kimi';
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

  process.env.SLICKLY_HOSTED_AI_PROVIDER = 'qwencloud';
  delete process.env.SLICKLY_QWENCLOUD_API_KEY;
  const missingKey = await invoke('chat', false, async () => {
    throw new Error('provider fetch must not run without a key');
  });
  assert.equal(missingKey.statusCode, 503);
  assert.match(JSON.parse(missingKey.body).error, /not configured/);

  console.log('PASS: hosted QwenCloud chat streaming, Moonshot Kimi chat, DeepSeek screen vision, server-only provider keys, and missing-key handling.');
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
