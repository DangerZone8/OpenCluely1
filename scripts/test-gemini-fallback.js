'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../api/gemini.js');
const originalFetch = global.fetch;
const originalKey = process.env.GEMINI_API_KEY;
function response() {
  return { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } };
}
async function invoke(fetchImpl, includeImage = true) {
  global.fetch = fetchImpl;
  const res = response();
  await handler({ method: 'POST', headers: { 'content-length': '100', 'x-opencluely-install-id': crypto.randomUUID() }, body: {
    model: 'gemini-3.5-flash-lite',
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
  });
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.text, 'SCREEN_TEST_OK');
  assert.equal(recovered.body.model, 'gemini-3.1-flash-lite');
  assert.deepEqual(calls, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  console.log('PASS: transient Gemini 503 falls back to an alternate model and succeeds.');
  const invalidCalls = [];
  const modelRejected = await invoke(async url => {
    const model = decodeURIComponent(url.match(/models\/([^:]+)/)[1]); invalidCalls.push(model);
    if (model === 'gemini-3.5-flash-lite') return { ok: false, status: 400, json: async () => ({ error: { status: 'INVALID_ARGUMENT', message: 'model-specific argument rejected' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'SCREEN_TEST_OK' }] } }] }) };
  });
  assert.equal(modelRejected.status, 200);
  assert.equal(modelRejected.body.model, 'gemini-3.1-flash-lite');
  assert.deepEqual(invalidCalls, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  console.log('PASS: model-specific INVALID_ARGUMENT switches to a supported fallback model.');
  const notFoundCalls = [];
  const missingModel = await invoke(async url => {
    const model = decodeURIComponent(url.match(/models\/([^:]+)/)[1]); notFoundCalls.push(model);
    if (model === 'gemini-3.5-flash-lite') return { ok: false, status: 404, json: async () => ({ error: { status: 'NOT_FOUND', message: 'model not found' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'SCREEN_TEST_OK' }] } }] }) };
  });
  assert.equal(missingModel.status, 200);
  assert.equal(missingModel.body.model, 'gemini-3.1-flash-lite');
  assert.deepEqual(notFoundCalls, ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite']);
  console.log('PASS: a retired/unavailable Gemini model name falls back to a supported model.');

  const failed = [];
  const exhausted = await invoke(async url => {
    failed.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1]));
    return { ok: false, status: 503, json: async () => ({ error: { status: 'UNAVAILABLE', message: 'high demand' } }) };
  });
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
  assert.equal(networkCalls.length, 1, 'network failure must not waste the remaining deadline trying other model IDs');
  assert.equal(networkFailed.body.providerCode, 'NETWORK_OR_TIMEOUT');
  console.log('PASS: provider network failure stops after one request instead of serially timing out on fallback models.');

  const textCalls = [];
  const fastText = await invoke(async url => {
    textCalls.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1]));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'FAST_TEXT_OK' }] } }] }) };
  }, false);
  assert.equal(fastText.status, 200);
  assert.equal(fastText.body.text, 'FAST_TEXT_OK');
  assert.equal(textCalls.length, 1, 'ordinary chat must use one fast-model request without serial fallback');
  console.log('PASS: ordinary text chat uses one fast-model request; screen vision keeps bounded fallback.');

  const quotaCalls = [];
  const quotaExhausted = await invoke(async url => {
    quotaCalls.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1]));
    return { ok: false, status: 429, json: async () => ({ error: { status: 'RESOURCE_EXHAUSTED', message: 'quota exhausted' } }) };
  });
  assert.equal(quotaExhausted.status, 429);
  assert.equal(quotaCalls.length, 1, 'quota exhaustion must stop immediately instead of consuming quota on fallback models');
  assert.equal(quotaExhausted.body.providerCode, 'RESOURCE_EXHAUSTED');
  assert.match(quotaExhausted.body.error, /retries are disabled/i);
  console.log('PASS: quota exhaustion stops after one provider request without trying fallback models.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = originalKey;
});
