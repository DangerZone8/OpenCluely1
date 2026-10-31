'use strict';

const assert = require('node:assert/strict');
const { executeProviderRequest, getProvider, extractParts } = require('../src/services/provider-adapter');

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

(async () => {
  const providers = [
    ['gemini', 'gemini-3.1-flash-lite'],
    ['openai', 'gpt-test'],
    ['xai', 'grok-test'],
    ['anthropic', 'claude-test']
  ];
  for (const [id, expectedModel] of providers) {
    const modelEnv = { gemini: 'GEMINI_MODEL', openai: 'OPENAI_MODEL', xai: 'XAI_MODEL', anthropic: 'ANTHROPIC_MODEL' }[id];
    const config = getProvider({ AI_PROVIDER: id, [modelEnv]: id === 'gemini' ? '' : expectedModel });
    assert.equal(config.id, id, id + ' provider selection');
    assert.equal(config.model, expectedModel, id + ' model selection');
  }
  assert.throws(() => getProvider({ AI_PROVIDER: 'not-a-provider' }), /Unsupported AI provider/);

  const imageRequest = {
    systemInstruction: { parts: [{ text: 'Be concise.' }] },
    contents: [{ role: 'user', parts: [
      { text: 'Describe this screenshot.' },
      { inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } }
    ] }],
    generationConfig: { maxOutputTokens: 128 }
  };
  const messages = extractParts(imageRequest);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].content[0].text, 'Describe this screenshot.');
  assert.match(messages[1].content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.throws(() => extractParts({ contents: [{ role: 'user', parts: [
    { inlineData: { mimeType: 'audio/webm', data: 'YXVkaW8=' } }
  ] }] }), /does not accept raw audio/);

  const chatCases = [
    ['openai', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'https://api.openai.com/v1/chat/completions',
      { choices: [{ message: { content: 'OpenAI test answer' } }] }],
    ['xai', 'XAI_API_KEY', 'XAI_MODEL', 'https://api.x.ai/v1/chat/completions',
      { choices: [{ message: { content: 'Grok test answer' } }] }],
    ['anthropic', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'https://api.anthropic.com/v1/messages',
      { content: [{ type: 'text', text: 'Claude test answer' }] }]
  ];
  for (const [provider, keyEnv, modelEnv, expectedUrl, body] of chatCases) {
    let calledUrl = '';
    const result = await executeProviderRequest(imageRequest, {
      AI_PROVIDER: provider, [keyEnv]: 'fake-test-key', [modelEnv]: 'test-model'
    }, async (url, options) => {
      calledUrl = url;
      if (provider === 'anthropic') {
        assert.equal(options.headers['x-api-key'], 'fake-test-key');
        assert.equal(options.headers['anthropic-version'], '2023-06-01');
      } else {
        assert.equal(options.headers.authorization, 'Bearer fake-test-key');
      }
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, 'test-model');
      assert.ok(payload.messages.length > 0);
      const userMessage = payload.messages.find(message => message.role === 'user');
      assert.ok(userMessage, provider + ' user message should be present');
      if (provider === 'anthropic') {
        assert.ok(userMessage.content.some(part => part.type === 'image'));
      } else {
        assert.ok(userMessage.content.some(part => part.type === 'image_url'));
      }
      return jsonResponse(body);
    });
    assert.equal(calledUrl, expectedUrl);
    assert.match(result, /test answer/);
  }

  let transcriptionCalled = false;
  let chatCalled = false;
  const audioResult = await executeProviderRequest({
    contents: [{ role: 'user', parts: [
      { text: 'Answer this spoken question.' },
      { inlineData: { mimeType: 'audio/webm', data: 'YXVkaW8=' } }
    ] }]
  }, { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'fake-test-key', OPENAI_MODEL: 'gpt-test' },
  async (url, options) => {
    if (url.endsWith('/audio/transcriptions')) {
      transcriptionCalled = true;
      assert.equal(options.headers.authorization, 'Bearer fake-test-key');
      assert.ok(options.body instanceof FormData);
      assert.equal(options.body.get('model'), 'gpt-4o-mini-transcribe');
      return jsonResponse({ text: 'Hinglish test transcript' });
    }
    chatCalled = true;
    const payload = JSON.parse(options.body);
    assert.ok(payload.messages.some(message => String(message.content).includes('Hinglish test transcript')));
    return jsonResponse({ choices: [{ message: { content: 'Audio answer' } }] });
  });
  assert.equal(transcriptionCalled, true);
  assert.equal(chatCalled, true);
  assert.equal(audioResult, 'Audio answer');

  await assert.rejects(
    executeProviderRequest({ contents: [{ role: 'user', parts: [{ text: 'hello' }] }] },
      { AI_PROVIDER: 'openai' }, async () => { throw new Error('must not call without key'); }),
    /Add a OpenAI API key/
  );
  await assert.rejects(
    executeProviderRequest({ contents: [{ role: 'user', parts: [{ text: 'hello' }] }] },
      { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'fake-key' },
      async () => jsonResponse({ error: { message: 'bad request' } }, 400)),
    /Anthropic API HTTP 400/
  );
  await assert.rejects(
    executeProviderRequest({ contents: [{ role: 'user', parts: [{ text: 'hello' }] }] },
      { AI_PROVIDER: 'xai', XAI_API_KEY: 'fake-key' },
      async () => jsonResponse({ choices: [{ message: { content: ' ' } }] })),
    /returned an empty response/
  );
  await assert.rejects(
    executeProviderRequest({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/webm', data: 'YXVkaW8=' } }] }] },
      { AI_PROVIDER: 'xai', XAI_API_KEY: 'fake-key' }, async () => { throw new Error('must not send unsupported audio'); }),
    /Raw audio analysis is not supported/
  );

  console.log('PASS: Gemini/OpenAI/xAI/Anthropic selection and models; OpenAI/xAI/Anthropic auth, text+vision payloads, OpenAI audio transcription, missing-key, provider-error, empty-response, and unsupported-audio paths.');
})().catch(error => {
  console.error('PROVIDER ADAPTER TEST FAILED:', error);
  process.exitCode = 1;
});
