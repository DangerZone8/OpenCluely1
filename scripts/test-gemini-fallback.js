'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../api/gemini.js');
const originalFetch = global.fetch;
const originalKey = process.env.GEMINI_API_KEY;
function response() {
  return { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, end(body) { this.body = body; } };
}
async function invoke(fetchImpl) {
  global.fetch = fetchImpl;
  const res = response();
  await handler({ method: 'POST', headers: { 'content-length': '100', 'x-opencluely-install-id': crypto.randomUUID() }, body: {
    model: 'gemini-3.5-flash-lite',
    request: { contents: [{ role: 'user', parts: [{ text: 'Describe this image' }, { inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }] }] }
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
  const failed = [];
  const exhausted = await invoke(async url => {
    failed.push(decodeURIComponent(url.match(/models\/([^:]+)/)[1]));
    return { ok: false, status: 503, json: async () => ({ error: { status: 'UNAVAILABLE', message: 'high demand' } }) };
  });
  assert.equal(exhausted.status, 502);
  assert.equal(failed.length, 5);
  assert.equal(new Set(failed).size, 5);
  assert.equal(exhausted.body.providerCode, 'UNAVAILABLE');
  console.log('PASS: each distinct fallback model is attempted at most once before returning a safe error.');
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
