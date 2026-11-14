'use strict';

const { json, authenticate, getConfig, safeError } = require('../_lib/slickly-auth');

module.exports = async function validateReferral(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Use POST to validate a referral code.' });
  }
  try {
    const { user } = await authenticate(req);
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(code)) return json(res, 400, { error: 'Enter a valid referral code.' });
    const config = getConfig();
    const url = config.supabaseUrl + '/rest/v1/slickly_referral_codes?select=id,code,discount_type,discount_value,monthly_price_paise,max_redemptions,redemption_count,expires_at,is_active&code=eq.' + encodeURIComponent(code) + '&limit=1';
    const response = await fetch(url, { headers: { apikey: config.serviceRoleKey, Authorization: 'Bearer ' + config.serviceRoleKey } });
    if (!response.ok) throw new Error('Could not validate that referral code.');
    const rows = await response.json();
    const item = rows[0];
    if (!item || !item.is_active || (item.expires_at && Date.parse(item.expires_at) <= Date.now()) || (item.max_redemptions !== null && item.redemption_count >= item.max_redemptions)) {
      return json(res, 404, { error: 'That referral code is invalid, expired or fully redeemed.' });
    }
    const already = await fetch(config.supabaseUrl + '/rest/v1/slickly_referral_redemptions?select=id,status&user_id=eq.' + encodeURIComponent(user.id) + '&status=in.(pending,redeemed)&limit=1', { headers: { apikey: config.serviceRoleKey, Authorization: 'Bearer ' + config.serviceRoleKey } });
    if (!already.ok) throw new Error('Could not check referral eligibility.');
    if ((await already.json()).length) return json(res, 409, { error: 'A referral code has already been applied to this account.' });
    return json(res, 200, {
      code: item.code, discountType: item.discount_type, discountValue: item.discount_value,
      monthlyPricePaise: item.monthly_price_paise,
      monthlyPriceDisplay: '₹' + (item.monthly_price_paise / 100).toFixed(2) + '/month'
    });
  } catch (error) {
    return safeError(res, error);
  }
};
