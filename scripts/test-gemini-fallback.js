'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../api/gemini.js');
const originalFetch = global.fetch;
const originalKey = process.env.GEMINI_API_KEY;
const originalKeys = process.env.GEMINI_API_KEYS;
const originalKey2 = process.env.GEMINI_API_KEY_2;
const originalKey3 = process.env.GEMINI_API_KEY_3;
const originalGoogleKey = process.env.GOOGLE_API_KEY;
const originalGoogleGenaiKey = process.env.GOOGLE_GENAI_API_KEY;
const originalGoogleGenerativeAiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
function response() {
  return { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } };
}
async function invoke(fetchImpl, includeImage = true, feature = 'chat', installId = crypto.randomUUID(), modelName = 'gemini-3.5-flash-lite') {
  global.fetch = fetchImpl;
  const res = response();
  await handler({ method: 'POST', headers: {
    'content-length': '100',
    'x-opencluely-install-id': installId,
    'x-opencluely-feature': feature
  }, body: {
    model: modelName,
    request: { contents: [{ role: 'user', parts: [{ text: includeImage ? 'Describe this image' : 'Reply briefly to this text chat test.' }, ...(includeImage ? [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] : [])] }] }
  } }, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}
async function main() {
  process.env.GEMINI_API_KEY = 'unit-test-key';
  const calls = [];
  const recovered = await invoke(async url => {
    const model = decodeURIComponent(url.match(/models\/([^:]+)/)[1]); calls.push(model);
    if (model === 'gemini-3.5-flash-lite') return { ok: false, status: 503, json: async () => ({ error: { status: 'UNAVAILABLE', message: 'high demand' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'SCREEN_TEST_OK' }] } }] }) };
  }, true, 'screen-vision');
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.text, 'SCREEN_TEST_OK');
  assert.equal(recovered.body.model, 'gemini-3.5-flash');
  assert.deepEqual(calls, ['gemini-3.5-flash-lite', 'gemini-3.5-flash']);
  console.log('PASS: transient Gemini 503 falls back to an alternate model and succeeds.');
  const gemini3Calls = [];
  const gemini3Primary = await invoke(async url => {
    const model = decodeURIComponent(url.match(/models\/([^:]+)/)[1]); gemini3Calls.push(model);
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'GEMINI_3_FLASH_OK' }] } }] }) };
  }, true, 'screen-vision', crypto.randomUUID(), 'gemini-3-flash-preview');
  assert.equal(gemini3Primary.status, 200);
  assert.equal(gemini3Primary.body.model, 'gemini-3-flash-preview');
  assert.deepEqual(gemini3Calls, ['gemini-3-flash-preview'],
    'Gemini 3 Flash must be the primary model for screen vision when explicitly selected.');
  console.log('PASS: Gemini 3 Flash preview is accepted and used as the primary screen-vision model.');

  const invalidCalls = [];
  const modelRejected = await invoke(async url => {
    const model = decodeURIComponent(url.match(/models\/([^:]+)/)[1]); invalidCalls.push(model);
    if (model === 'gemini-3.5-flash-lite') return { ok: false, status: 400, json: async () => ({ error: { status: 'INVALID_ARGUMENT', message: 'model-specific argument rejected' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'SCREEN_TEST_OK' }] } }] }) };
  }, true, 'screen-vision');
  assert.equal(modelRejected.status, 200);
  assert.equal(modelRejected.body.model, 'gemini-3.5-flash');
  assert.deepEqual(invalidCalls, ['gemini-3.5-flash-lite', 'gemini-3.5-flash']);
  console.log('PASS: model-specific INVALID_ARGUMENT switches to a supported fallback model.');
  const notFoundCalls = [];
  const missingModel = await invoke(async url => {
    const model = decodeURIComponent(url.match(/models\/([^:]+)/)[1]); notFoundCalls.push(model);
    if (model === 'gemini-3.5-flash-lite') return { ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND', message: 'model not found' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'SCREEN_TEST_OK' }] } }] }) };
  }, true, 'screen-vision');
  assert.equal(missingModel.status, 200);
  assert.equal(missingModel.body.model, 'gemini-3.5-flash');
  assert.deepEqual(notFoundCalls, ['gemini-3.5-flash-lite', 'gemini-3.5-flash']);
  console.log('PASS: a retired/unavailable Gemini model name falls back to a supported model.');

  const failed = [];
  const exhausted = await invoke(async url => {
    failed.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1]));
    return { ok: false, status: 503, json: async () => ({ error: { status: 'UNAVAILABLE', message: 'high demand' } }) };
  }, true, 'screen-vision');
  assert.equal(exhausted.status, 502);
  assert.equal(failed.length, 2, 'proxy should cap fallback to two models within its request deadline');
  assert.equal(new Set(failed).size, 2, 'proxy must use distinct fallback models');
  assert.equal(exhausted.body.providerCode, 'UNAVAILABLE');
  console.log('PASS: proxy attempts at most two distinct models before returning a bounded-time safe error.');
  const networkCalls = [];
  const networkFailed = await invoke(async url => {
    networkCalls.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1]));
    throw new TypeError('fetch failed');
  });
  assert.equal(networkFailed.status, 502);
  assert.equal(networkCalls.length, 2, 'a timed-out model may be overloaded, so try exactly one distinct fallback within the overall deadline');
  assert.equal(networkFailed.body.providerCode, 'NETWORK_OR_TIMEOUT');
  console.log('PASS: provider timeout gets one bounded alternate-model attempt.');

  const textCalls = [];
  const fastText = await invoke(async url => {
    textCalls.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1]));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'FAST_TEXT_OK' }] } }] }) };
  }, false);
  assert.equal(fastText.status, 200);
  assert.equal(fastText.body.text, 'FAST_TEXT_OK');
  assert.equal(textCalls.length, 1, 'ordinary chat must use one fast-model request without serial fallback');
  console.log('PASS: ordinary text chat uses one fast-model request; screen vision keeps bounded fallback.');
  const textFailureCalls = [];
  const textFailure = await invoke(async url => {
    const model = decodeURIComponent(url.match(/models\/([^:]+)/)[1]);
    textFailureCalls.push(model);
    if (model === 'gemini-3.5-flash-lite') {
      return { ok: false, status: 503, json: async () => ({ error: { status: 'UNAVAILABLE', message: 'high demand' } }) };
    }
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'FAST_TEXT_FALLBACK_OK' }] } }] }) };
  }, false, 'chat');
  assert.equal(textFailure.status, 200);
  assert.equal(textFailure.body.text, 'FAST_TEXT_FALLBACK_OK');
  assert.deepEqual(textFailureCalls, ['gemini-3.5-flash-lite', 'gemini-3.5-flash'],
    'ordinary chat must use one alternate model after an explicit transient provider failure');
  console.log('PASS: ordinary chat keeps one-call fast path and retries once on an explicit transient model failure.');


  // Isolate this assertion to a single configured key; CI may provide
  // additional key-pool secrets, which are tested explicitly in test-keyless-ai.
  delete process.env.GEMINI_API_KEYS;
  delete process.env.GEMINI_API_KEY_2;
  delete process.env.GEMINI_API_KEY_3;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_GENAI_API_KEY;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const quotaCalls = [];
  const quotaExhausted = await invoke(async url => {
    quotaCalls.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1]));
    return { ok: false, status: 429, json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota exhausted' } }) };
  });
  assert.equal(quotaExhausted.status, 429);
  assert.equal(quotaCalls.length, 1, 'quota exhaustion must stop immediately instead of consuming quota on fallback models');
  assert.equal(quotaExhausted.body.providerCode, 'RESOURCE_EXHAUSTED');
  assert.match(quotaExhausted.body.error, /quota is exhausted/i);
  console.log('PASS: with one configured key, quota exhaustion stops without retrying another model.');
  const sharedInstall = crypto.randomUUID();
  const screenBudget = await invoke(async () => ({
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'SCREEN_BUDGET_OK' }] } }] })
  }), true, 'screen-vision', sharedInstall);
  const chatBudget = await invoke(async () => ({
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'CHAT_BUDGET_OK' }] } }] })
  }), false, 'chat', sharedInstall);
  assert.equal(screenBudget.status, 200);
  assert.equal(chatBudget.status, 200);
  const counters = globalThis.__openCluelyGeminiCounters;
  assert.ok(counters.has('install:' + sharedInstall + ':screen-vision'),
    'screen vision must use its own per-install budget');
  assert.ok(counters.has('install:' + sharedInstall + ':chat'),
    'chat must use a separate per-install budget');
  console.log('PASS: live screen vision and conversational chat have isolated request budgets.');

}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
  if (originalKeys === undefined) delete process.env.GEMINI_API_KEYS; else process.env.GEMINI_API_KEYS = originalKeys;
  if (originalKey2 === undefined) delete process.env.GEMINI_API_KEY_2; else process.env.GEMINI_API_KEY_2 = originalKey2;
  if (originalKey3 === undefined) delete process.env.GEMINI_API_KEY_3; else process.env.GEMINI_API_KEY_3 = originalKey3;
  if (originalGoogleKey === undefined) delete process.env.GOOGLE_API_KEY; else process.env.GOOGLE_API_KEY = originalGoogleKey;
  if (originalGoogleGenaiKey === undefined) delete process.env.GOOGLE_GENAI_API_KEY; else process.env.GOOGLE_GENAI_API_KEY = originalGoogleGenaiKey;
  if (originalGoogleGenerativeAiKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; else process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalGoogleGenerativeAiKey;
});
