'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const checkout = fs.readFileSync(path.join(root, 'api/billing/checkout.js'), 'utf8');
const webhook = fs.readFileSync(path.join(root, 'api/billing/webhook.js'), 'utf8');
const pricing = fs.readFileSync(path.join(root, 'web/pricing.html'), 'utf8');
const account = fs.readFileSync(path.join(root, 'web/account.html'), 'utf8');
const docs = fs.readFileSync(path.join(root, 'docs/SLICKLY_PRO_ACCOUNTS_AND_CREDITS.md'), 'utf8');

assert.match(checkout, /SLICKLY_BILLING_ENABLED[\s\S]{0,160}!==\s*'true'/);
assert.ok(checkout.indexOf("SLICKLY_BILLING_ENABLED") < checkout.indexOf("authenticate(req)"),
  'billing feature flag must fail closed before authentication or provider calls');
assert.match(checkout, /RAZORPAY_KEY_ID/);
assert.match(checkout, /RAZORPAY_KEY_SECRET/);
assert.match(webhook, /timingSafeEqual/);
assert.match(webhook, /x-razorpay-event-id/);
assert.match(webhook, /apply_slickly_razorpay_event/);
assert.match(pricing, /credit\/debit cards/i);
assert.match(pricing, /UPI Autopay/i);
assert.match(pricing, /Google Pay/i);
assert.match(pricing, /eMandate\/netbanking/i);
assert.match(account, /Payment details are entered only on the provider checkout/i);
assert.match(docs, /adult\/business representative must complete merchant KYC and register\/verify the business bank account/i);
assert.match(docs, /sandbox tests/i);

console.log('PASS: checkout fail-closed gate, signature/idempotency checks, payment-method disclosures and adult merchant payout-bank requirements.');
