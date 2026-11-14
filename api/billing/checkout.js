'use strict';

const { json, authenticate, getConfig, rpc, safeError } = require('../_lib/slickly-auth');

module.exports = async function checkout(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Use POST to start a Slickly Pro subscription.' });
  }
  let reservation = null;
  let userId = null;
  try {
    const { user } = await authenticate(req);
    userId = user.id;
    const keyId = String(process.env.RAZORPAY_KEY_ID || '');
    const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '');
    const basePlanId = String(process.env.RAZORPAY_PRO_PLAN_ID || '');
    if (!keyId || !keySecret) return json(res, 503, { error: 'Slickly Pro checkout is not enabled yet. Please try again later.' });

    const config = getConfig();
    const referralCode = String(req.body?.referralCode || '').trim().toUpperCase();
    let planId = basePlanId;
    let priceDisplay = '₹399/month';
    let referralNotes = {};
    if (referralCode) {
      if (!/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(referralCode)) return json(res, 400, { error: 'Enter a valid referral code.' });
      reservation = await rpc(config, 'reserve_slickly_referral', { p_code: referralCode, p_user_id: user.id });
      if (!reservation?.plan_id || !reservation?.redemption_id) throw new Error('Could not reserve this referral code.');
      planId = reservation.plan_id;
      priceDisplay = '₹' + (Number(reservation.monthly_price_paise) / 100).toFixed(2) + '/month';
      referralNotes = { referral_code: reservation.code, referral_redemption_id: reservation.redemption_id };
    }
    if (!planId) return json(res, 503, { error: 'Slickly Pro pricing is not configured yet.' });

    const response = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plan_id: planId, total_count: 120, quantity: 1, customer_notify: 1,
        notes: { slickly_user_id: user.id, product: 'slickly_pro', ...referralNotes }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.short_url !== 'string' || typeof data.id !== 'string') {
      console.error('Razorpay subscription creation failed:', response.status, data?.error?.code || 'provider_error');
      if (reservation?.redemption_id) await rpc(config, 'release_slickly_referral', { p_redemption_id: reservation.redemption_id, p_user_id: user.id }).catch(() => {});
      reservation = null;
      return json(res, 502, { error: 'Slickly could not start checkout. No subscription was activated and the referral reservation was released.' });
    }
    if (reservation?.redemption_id) {
      const headers = { apikey: config.serviceRoleKey, Authorization: 'Bearer ' + config.serviceRoleKey, 'Content-Type': 'application/json' };
      await fetch(config.supabaseUrl + '/rest/v1/slickly_referral_redemptions?id=eq.' + encodeURIComponent(reservation.redemption_id), {
        method: 'PATCH', headers, body: JSON.stringify({ provider_subscription_id: data.id })
      });
    }
    return json(res, 200, {
      checkoutUrl: data.short_url, subscriptionId: data.id, plan: 'pro',
      priceDisplay, referralCode: reservation?.code || null, entitlement: 'pending_webhook'
    });
  } catch (error) {
    if (reservation?.redemption_id && userId) {
      try {
        const config = getConfig();
        await rpc(config, 'release_slickly_referral', { p_redemption_id: reservation.redemption_id, p_user_id: userId });
      } catch {}
    }
    return safeError(res, error);
  }
};
