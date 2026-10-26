'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../api/gemini.js');
const originalFetch = global.fetch;
const originalEnv = Object.fromEntries([
  'GEMINI_API_KEY','GEMINI_API_KEYS','GEMINI_API_KEY_2','GEMINI_API_KEY_3',
  'GOOGLE_API_KEY','GOOGLE_GENAI_API_KEY','GOOGLE_GENERATIVE_AI_API_KEY'
].map(key => [key, process.env[key]]));

function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } };
}
async function invoke(fetchImpl, feature = 'chat', installId = crypto.randomUUID()) {
  global.fetch = fetchImpl;
  const res = response();
  await handler({
    method: 'POST',
    headers: {
      'content-length': '100',
      'x-opencluely-install-id': installId,
      'x-opencluely-feature': feature
    },
    body: { model: 'some-other-model-must-be-ignored', request: {
      contents: [{ role: 'user', parts: [{ text: 'Reply briefly to this test.' }] }]
    } }
  }, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
async function main() {
  process.env.GEMINI_API_KEY = 'unit-test-key';
  delete process.env.GEMINI_API_KEYS;
  delete process.env.GEMINI_API_KEY_2;
  delete process.env.GEMINI_API_KEY_3;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_GENAI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  const successCalls = [];
  const success = await invoke(async url => {
    successCalls.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1]));
    return { ok: true, status: 200, json: async () => ({
      candidates: [{ content: { parts: [{ text: 'GEMINI_3_ONLY_OK' }] } }]
    }) };
  }, 'screen-vision');
  assert.equal(success.status, 200);
  assert.equal(success.body.text, 'GEMINI_3_ONLY_OK');
  assert.equal(success.body.model, 'gemini-3-flash-preview');
  assert.deepEqual(successCalls, ['gemini-3-flash-preview']);
  console.log('PASS: screen vision uses Gemini 3 Flash Preview only, ignoring a caller-supplied model.');

  const unavailableCalls = [];
  const unavailable = await invoke(async url => {
    unavailableCalls.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1]));
    return { ok: false, status: 503, json: async () => ({
      error: { status: 'UNAVAILABLE', message: 'temporarily unavailable' }
    }) };
  });
  assert.equal(unavailable.status, 502);
  assert.deepEqual(unavailableCalls, ['gemini-3-flash-preview', 'gemini-3-flash-preview'],
    'may retry Gemini 3 once for a transient failure, but must never call a different model');
  assert.deepEqual(unavailable.body.attemptedModels, ['gemini-3-flash-preview']);
  console.log('PASS: transient Gemini 3 failures get one bounded same-model retry, without model fallback.');

  const quotaCalls = [];
  const quota = await invoke(async url => {
    quotaCalls.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1]));
    return { ok: false, status: 429, json: async () => ({
      error: { status: 'RESOURCE_EXHAUSTED', message: 'quota exhausted' }
    }) };
  });
  assert.equal(quota.status, 429);
  assert.equal(quota.body.providerCode, 'RESOURCE_EXHAUSTED');
  assert.deepEqual(quotaCalls, ['gemini-3-flash-preview']);
  console.log('PASS: quota exhaustion does not trigger calls to other models.');

  const installId = crypto.randomUUID();
  const screenBudget = await invoke(async () => ({ ok: true, status: 200, json: async () => ({
    candidates: [{ content: { parts: [{ text: 'SCREEN_BUDGET_OK' }] } }]
  }) }), 'screen-vision', installId);
  const chatBudget = await invoke(async () => ({ ok: true, status: 200, json: async () => ({
    candidates: [{ content: { parts: [{ text: 'CHAT_BUDGET_OK' }] } }]
  }) }), 'chat', installId);
  assert.equal(screenBudget.status, 200);
  assert.equal(chatBudget.status, 200);
  const counters = globalThis.__openCluelyGeminiCounters;
  assert.ok(counters.has('install:' + installId + ':screen-vision'));
  assert.ok(counters.has('install:' + installId + ':chat'));
  console.log('PASS: chat and screen vision retain isolated request budgets.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
