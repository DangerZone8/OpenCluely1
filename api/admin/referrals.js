'use strict';

const { json, authenticate, getConfig, safeError } = require('../_lib/slickly-auth');

function isAdmin(user) {
  const allowed = String(process.env.SLICKLY_REFERRAL_ADMIN_EMAILS || '')
    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  return Boolean(user?.email && allowed.includes(String(user.email).toLowerCase()));
}
function razorpayAuth() {
  const id = String(process.env.RAZORPAY_KEY_ID || '');
  const secret = String(process.env.RAZORPAY_KEY_SECRET || '');
  if (!id || !secret) {
    const error = new Error('Referral discounts are not enabled until billing is configured.');
    error.statusCode = 503;
    throw error;
  }
  return 'Basic ' + Buffer.from(id + ':' + secret).toString('base64');
}
async function adminContext(req) {
  const auth = await authenticate(req);
  if (!isAdmin(auth.user)) {
    const error = new Error('This account is not authorised to manage referral codes.');
    error.statusCode = 403;
    throw error;
  }
  return auth;
}
module.exports = async function referrals(req, res) {
  try {
    const auth = await adminContext(req);
    const config = getConfig();
    const base = config.supabaseUrl + '/rest/v1/slickly_referral_codes';
    const headers = { apikey: config.serviceRoleKey, Authorization: 'Bearer ' + config.serviceRoleKey, 'Content-Type': 'application/json' };

    if (req.method === 'GET') {
      const response = await fetch(base + '?select=id,code,discount_type,discount_value,monthly_price_paise,max_redemptions,redemption_count,expires_at,is_active,created_at&order=created_at.desc', { headers });
      if (!response.ok) throw new Error('Could not load referral codes.');
      return json(res, 200, { codes: await response.json() });
    }
    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const code = String(body.code || '').trim().toUpperCase();
      const discountType = String(body.discountType || '');
      const discountValue = Number(body.discountValue);
      const maxRedemptions = body.maxRedemptions === '' || body.maxRedemptions == null ? null : Number(body.maxRedemptions);
      const expiresAt = body.expiresAt ? new Date(body.expiresAt).toISOString() : null;
      if (!/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(code)) return json(res, 400, { error: 'Code must be 3–24 characters: letters, numbers or hyphens.' });
      if (!['percent', 'fixed'].includes(discountType) || !Number.isInteger(discountValue)) return json(res, 400, { error: 'Choose a valid discount type and whole-number value.' });
      if (discountType === 'percent' && (discountValue < 1 || discountValue > 90)) return json(res, 400, { error: 'Percentage discounts must be between 1% and 90%.' });
      if (discountType === 'fixed' && (discountValue < 1 || discountValue > 398)) return json(res, 400, { error: 'Fixed discounts must be between ₹1 and ₹398.' });
      if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 100000)) return json(res, 400, { error: 'Maximum redemptions must be between 1 and 100,000.' });
      if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) return json(res, 400, { error: 'Expiry must be a future date.' });

      const existing = await fetch(base + '?select=id&code=eq.' + encodeURIComponent(code) + '&limit=1', { headers });
      if (!existing.ok) throw new Error('Could not check whether that referral code already exists.');
      if ((await existing.json()).length) return json(res, 409, { error: 'That referral code already exists.' });

      const price = discountType === 'percent'
        ? Math.round(39900 * (100 - discountValue) / 100)
        : 39900 - discountValue * 100;
      if (price < 100) return json(res, 400, { error: 'The discounted monthly price must be at least ₹1.' });

      const planResponse = await fetch('https://api.razorpay.com/v1/plans', {
        method: 'POST',
        headers: { Authorization: razorpayAuth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period: 'monthly', interval: 1,
          item: { name: 'Slickly Pro', amount: price, currency: 'INR', description: 'Slickly Pro monthly subscription with referral code ' + code },
          notes: { product: 'slickly_pro', referral_code: code }
        })
      });
      const plan = await planResponse.json().catch(() => ({}));
      if (!planResponse.ok || typeof plan.id !== 'string') {
        console.error('Razorpay discounted plan creation failed:', planResponse.status, plan?.error?.code || 'provider_error');
        return json(res, 502, { error: 'The payment provider could not create the discounted plan. No code was saved.' });
      }

      const insert = await fetch(base, {
        method: 'POST',
        headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({
          code, discount_type: discountType, discount_value: discountValue,
          monthly_price_paise: price, razorpay_plan_id: plan.id,
          max_redemptions: maxRedemptions, expires_at: expiresAt,
          is_active: true, created_by: auth.user.id
        })
      });
      const created = await insert.json().catch(() => ({}));
      if (!insert.ok) {
        console.error('Referral code database insert failed:', insert.status, created?.code || created?.message || 'database_error');
        return json(res, insert.status === 409 ? 409 : 503, { error: insert.status === 409 ? 'That referral code already exists.' : 'The payment plan was created but the code could not be saved. Contact support before retrying.' });
      }
      return json(res, 201, { code: Array.isArray(created) ? created[0] : created, priceDisplay: '₹' + (price / 100).toFixed(2) + '/month' });
    }
    if (req.method === 'PATCH') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const id = String(body.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id) || typeof body.isActive !== 'boolean') return json(res, 400, { error: 'Provide a valid code ID and active state.' });
      const response = await fetch(base + '?id=eq.' + encodeURIComponent(id), {
        method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ is_active: body.isActive })
      });
      const updated = await response.json().catch(() => []);
      if (!response.ok) throw new Error('Could not update referral code.');
      return json(res, 200, { code: Array.isArray(updated) ? updated[0] : updated });
    }
    res.setHeader('Allow', 'GET, POST, PATCH');
    return json(res, 405, { error: 'Use GET, POST or PATCH.' });
  } catch (error) {
    return safeError(res, error);
  }
};
