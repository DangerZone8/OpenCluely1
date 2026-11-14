'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const admin = fs.readFileSync(path.join(__dirname, '../api/admin/referrals.js'), 'utf8');
const validate = fs.readFileSync(path.join(__dirname, '../api/referrals/validate.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/202611140002_slickly_referral_codes.sql'), 'utf8');
const checkout = fs.readFileSync(path.join(__dirname, '../api/billing/checkout.js'), 'utf8');
const webhook = fs.readFileSync(path.join(__dirname, '../api/billing/webhook.js'), 'utf8');

assert.match(admin, /SLICKLY_REFERRAL_ADMIN_EMAILS/);
assert.match(admin, /discountType === 'percent'.*discountValue < 1.*discountValue > 90/s);
assert.match(admin, /discountType === 'fixed'.*discountValue < 1.*discountValue > 398/s);
assert.match(admin, /monthly_price_paise: price/);
assert.match(admin, /period: 'monthly', interval: 1/);
assert.match(validate, /authenticate\(req\)/);
assert.match(validate, /status=in\.\(pending,redeemed\)/);
assert.match(migration, /for update/);
assert.match(migration, /max_redemptions/);
assert.match(migration, /unique\(code_id, user_id\)/);
assert.match(migration, /grant execute on function public\.reserve_slickly_referral/);
assert.match(checkout, /reserve_slickly_referral/);
assert.match(webhook, /redeem_slickly_referral/);
console.log('Slickly referral code regression checks passed.');
