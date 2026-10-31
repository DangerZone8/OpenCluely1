'use strict';

const assert = require('node:assert/strict');
const { executeProviderRequest, getProvider, extractParts } = require('../src/services/provider-adapter');

(async () => {
  assert.equal(getProvider({ AI_PROVIDER: 'gemini' }).model, 'gemini-3.1-flash-lite');
  assert.equal(getProvider({ AI_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-test' }).model, 'gpt-test');
  assert.throws(() => getProvider({ AI_PROVIDER: 'other' }), /Unsupported AI provider/);

  const request = {
    systemInstruction: { parts: [{ text: 'Be concise.' }] },
    contents: [{ role: 'user', parts: [
      { text: 'Describe this screenshot.' },
      { inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } }
    ] }],
    generationConfig: { maxOutputTokens: 128 }
  };
  const messages = extractParts(request);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].content[0].text, 'Describe this screenshot.');
  assert.match(messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);

  for (const [provider, keyEnv, expectedUrl, responseBody] of [
    ['openai', 'OPENAI_API_KEY', 'https://api.openai.com/v1/chat/completions', { choices: [{ message: { content: 'OpenAI test answer' } }] }],
    ['xai', 'XAI_API_KEY', 'https://api.x.ai/v1/chat/completions', { choices: [{ message: { content: 'Grok test answer' } }] }],
    ['anthropic', 'ANTHROPIC_API_KEY', 'https://api.anthropic.com/v1/messages', { content: [{ type: 'text', text: 'Claude test answer' }] }]
  ]) {
    let calledUrl = '';
    const modelEnv = { openai: 'OPENAI_MODEL', xai: 'XAI_MODEL', anthropic: 'ANTHROPIC_MODEL' }[provider];
    const env = { AI_PROVIDER: provider, [keyEnv]: 'fake-test-key', [modelEnv]: 'test-model' };
    const result = await executeProviderRequest(request, env, async (url, options) => {
      calledUrl = url;
      const headers = options.headers;
      assert.ok(headers.authorization || headers['x-api-key'], 'provider credential header must be set');
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, 'test-model');
      assert.ok(payload.messages.length);
      return { ok: true, status: 200, json: async () => responseBody };
    });
    assert.equal(calledUrl, expectedUrl);
    assert.match(result, /test answer/);
  }

  await assert.rejects(
    executeProviderRequest({ contents: [{ role: 'user', parts: [{ text: 'hello' }] }] }, { AI_PROVIDER: 'openai' }, async () => { throw new Error('must not call without key'); }),
    /Add a OpenAI API key/
  );
  console.log('PASS: Gemini, OpenAI, xAI and Anthropic provider routing, vision payloads and missing-key handling.');
})().catch(error => {
  console.error('PROVIDER ADAPTER TEST FAILED:', error);
  process.exitCode = 1;
});
