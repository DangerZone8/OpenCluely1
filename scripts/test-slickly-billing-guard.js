'use strict';
const assert = require('node:assert/strict');
const checkout = require('../api/billing/checkout');
const original = process.env.SLICKLY_BILLING_ENABLED;
const originalFetch = global.fetch;

(async () => {
  delete process.env.SLICKLY_BILLING_ENABLED;
  let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; throw new Error('checkout must remain closed'); };
  const res = {
    statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; }
  };
  await checkout({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 503);
  assert.match(JSON.parse(res.body).error, /not open yet/);
  assert.equal(fetchCalls, 0, 'disabled billing must not contact Supabase or Razorpay');

  process.env.SLICKLY_BILLING_ENABLED = 'false';
  const resFalse = {
    statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body; }
  };
  await checkout({ method: 'POST', headers: {}, body: {} }, resFalse);
  assert.equal(resFalse.statusCode, 503);
  assert.equal(fetchCalls, 0);

  console.log('PASS: Pro checkout fails closed unless SLICKLY_BILLING_ENABLED is explicitly true.');
})().catch(error => {
  console.error('SLICKLY BILLING GUARD TEST FAILED:', error);
  process.exitCode = 1;
}).finally(() => {
  global.fetch = originalFetch;
  if (original === undefined) delete process.env.SLICKLY_BILLING_ENABLED;
  else process.env.SLICKLY_BILLING_ENABLED = original;
});
