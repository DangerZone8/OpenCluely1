import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiPayload, requestAssistantReply } from './chat-api.js';

const installId = '123e4567-e89b-42d3-a456-426614174000';

test('builds Gemini conversation contents with model roles for assistant replies', () => {
  const payload = buildGeminiPayload([
    { role: 'user', text: 'Hello' },
    { role: 'assistant', text: 'Hi there' },
    { role: 'user', text: 'Follow up' }
  ]);

  assert.deepEqual(payload.request.contents, [
    { role: 'user', parts: [{ text: 'Hello' }] },
    { role: 'model', parts: [{ text: 'Hi there' }] },
    { role: 'user', parts: [{ text: 'Follow up' }] }
  ]);
  assert.equal(payload.request.generationConfig.maxOutputTokens, 2048);
});

test('limits submitted context to the most recent 20 messages', () => {
  const messages = Array.from({ length: 25 }, (_, index) => ({
    role: 'user',
    text: 'Message ' + index
  }));
  const payload = buildGeminiPayload(messages);
  assert.equal(payload.request.contents.length, 20);
  assert.equal(payload.request.contents[0].parts[0].text, 'Message 5');
});

test('sends the hosted request with a stable installation ID and chat feature header', async () => {
  let captured;
  const reply = await requestAssistantReply({
    messages: [{ role: 'user', text: 'Explain recursion' }],
    installId,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, json: async () => ({ text: 'A function calling itself.' }) };
    }
  });

  assert.equal(reply, 'A function calling itself.');
  assert.equal(captured.url, 'https://slicklyai.vercel.app/api/gemini');
  assert.equal(captured.options.headers['x-opencluely-install-id'], installId);
  assert.equal(captured.options.headers['x-opencluely-feature'], 'chat');
  assert.equal(JSON.parse(captured.options.body).request.contents[0].parts[0].text, 'Explain recursion');
});

test('rejects invalid installation identifiers before making a request', async () => {
  await assert.rejects(
    requestAssistantReply({ messages: [{ role: 'user', text: 'Hi' }], installId: 'invalid' }),
    /secure installation identifier/
  );
});

test('shows a useful message when the hosted service rate-limits a request', async () => {
  await assert.rejects(
    requestAssistantReply({
      messages: [{ role: 'user', text: 'Hi' }],
      installId,
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: 'rate limit' }) })
    }),
    /usage limit/
  );
});
