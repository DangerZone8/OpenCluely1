'use strict';

const { json, authenticate, safeError } = require('../_lib/slickly-auth');

module.exports = async function checkout(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Use POST to start a Slickly Pro subscription.' });
  }
  try {
    const { user } = await authenticate(req);
    const keyId = String(process.env.RAZORPAY_KEY_ID || '');
    const keySecret = String(process.env.RAZORPAY_KEY_SECRET || '');
    const planId = String(process.env.RAZORPAY_PRO_PLAN_ID || '');
    if (!keyId || !keySecret || !planId) {
      return json(res, 503, { error: 'Slickly Pro checkout is not enabled yet. Please try again later.' });
    }
    // The plan is configured server-side; clients cannot choose an amount or plan.
    const response = await fetch('https://api.razorpay.com/v1/subscriptions', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        plan_id: planId,
        total_count: 120,
        quantity: 1,
        customer_notify: 1,
        notes: { slickly_user_id: user.id, product: 'slickly_pro' }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.short_url !== 'string' || typeof data.id !== 'string') {
      console.error('Razorpay subscription creation failed:', response.status, data?.error?.code || 'provider_error');
      return json(res, 502, { error: 'Slickly could not start checkout. No subscription was activated.' });
    }
    return json(res, 200, {
      checkoutUrl: data.short_url,
      subscriptionId: data.id,
      plan: 'pro',
      priceDisplay: '₹399/month',
      entitlement: 'pending_webhook'
    });
  } catch (error) {
    return safeError(res, error);
  }
};
