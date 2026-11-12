import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeminiPayload, buildScreenVisionPayload, requestAssistantReply, requestScreenAnalysis } from './chat-api.js';

const installId = '123e4567-e89b-42d3-a456-426614174000';

test('builds Gemini conversation contents with model roles for assistant replies', () => {
  const payload = buildGeminiPayload([
    { role: 'user', text: 'Hello' }, { role: 'assistant', text: 'Hi there' }, { role: 'user', text: 'Follow up' }
  ]);
  assert.deepEqual(payload.request.contents, [
    { role: 'user', parts: [{ text: 'Hello' }] },
    { role: 'model', parts: [{ text: 'Hi there' }] },
    { role: 'user', parts: [{ text: 'Follow up' }] }
  ]);
  assert.equal(payload.request.generationConfig.maxOutputTokens, 2048);
  assert.match(payload.request.systemInstruction.parts[0].text, /conversation history/);
  assert.match(payload.request.systemInstruction.parts[0].text, /clear steps/);
  assert.match(payload.request.systemInstruction.parts[0].text, /small relevant example/);
});

test('limits submitted chat context to the most recent 20 messages', () => {
  const messages = Array.from({ length: 25 }, (_, index) => ({ role: 'user', text: 'Message ' + index }));
  const payload = buildGeminiPayload(messages);
  assert.equal(payload.request.contents.length, 20);
  assert.equal(payload.request.contents[0].parts[0].text, 'Message 5');
});

test('builds multimodal screen payload with screenshot and conversation history', () => {
  const payload = buildScreenVisionPayload({
    imageBase64: 'aGVsbG8=', mimeType: 'image/png', prompt: 'Read this screen',
    history: [{ role: 'user', text: 'Earlier question' }]
  });
  assert.equal(payload.request.contents.length, 2);
  assert.deepEqual(payload.request.contents[1].parts[0], { text: 'Read this screen' });
  assert.deepEqual(payload.request.contents[1].parts[1], { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } });
  assert.match(payload.request.systemInstruction.parts[0].text, /most recent user-provided screen analysis/);
});

test('sends chat with stable installation ID and chat feature header', async () => {
  let captured;
  const reply = await requestAssistantReply({
    messages: [{ role: 'user', text: 'Explain recursion' }], installId,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, json: async () => ({ text: 'A function calling itself.' }) };
    }
  });
  assert.equal(reply, 'A function calling itself.');
  assert.equal(captured.options.headers['x-opencluely-install-id'], installId);
  assert.equal(captured.options.headers['x-opencluely-feature'], 'chat');
});

test('sends screenshot analysis through the isolated screen-vision budget', async () => {
  let captured;
  const answer = await requestScreenAnalysis({
    imageBase64: 'aGVsbG8=', mimeType: 'image/jpeg', prompt: 'Describe screenshot',
    history: [{ role: 'user', text: 'What is this?' }], installId,
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return { ok: true, status: 200, json: async () => ({ text: 'A page with a question.' }) };
    }
  });
  assert.equal(answer, 'A page with a question.');
  assert.equal(captured.options.headers['x-opencluely-feature'], 'screen-vision');
  const sent = JSON.parse(captured.options.body);
  assert.equal(sent.request.contents.at(-1).parts[1].inlineData.data, 'aGVsbG8=');
  assert.equal(sent.request.contents[0].parts[0].text, 'What is this?');
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
      messages: [{ role: 'user', text: 'Hi' }], installId,
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: 'rate limit' }) })
    }),
    /usage limit/
  );
});
