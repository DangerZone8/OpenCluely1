'use strict';

const crypto = require('node:crypto');
const { json, getConfig, rpc, safeError } = require('../_lib/slickly-auth');

async function rawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);
  // Razorpay signatures cover the exact bytes sent by the provider. Re-serializing
  // Vercel's parsed JSON body changes whitespace/key ordering and breaks verification.
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error('Webhook payload is too large.'), { statusCode: 413 });
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = async function webhook(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Use POST for payment webhooks.' });
  }
  try {
    const secret = String(process.env.RAZORPAY_WEBHOOK_SECRET || '');
    if (!secret) return json(res, 503, { error: 'Billing webhook is not configured.' });
    const raw = await rawBody(req);
    const supplied = String(req.headers['x-razorpay-signature'] || '');
    const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(supplied, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (!/^[a-f0-9]{64}$/i.test(supplied) || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return json(res, 401, { error: 'Invalid webhook signature.' });
    }
    let event;
    try { event = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'Invalid webhook JSON.' }); }
    const eventId = String(req.headers['x-razorpay-event-id'] || '');
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(eventId)) {
      return json(res, 400, { error: 'Missing or invalid webhook event identifier.' });
    }
    const subscription = event?.payload?.subscription?.entity;
    if (!subscription || typeof subscription.id !== 'string') {
      // Acknowledge unrelated, correctly signed Razorpay events without granting access.
      return json(res, 200, { received: true, ignored: true });
    }
    const userId = String(subscription.notes?.slickly_user_id || '');
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      return json(res, 400, { error: 'Subscription is missing its Slickly account reference.' });
    }
    const allowedEvents = new Set([
      'subscription.activated', 'subscription.authenticated', 'subscription.charged',
      'subscription.pending', 'subscription.halted', 'subscription.paused',
      'subscription.resumed', 'subscription.cancelled', 'subscription.completed'
    ]);
    if (!allowedEvents.has(String(event.event || ''))) {
      return json(res, 200, { received: true, ignored: true });
    }
    const config = getConfig();
    const result = await rpc(config, 'apply_slickly_razorpay_event', {
      p_event_id: eventId,
      p_user_id: userId,
      p_provider_subscription_id: subscription.id,
      p_event_type: String(event.event),
      p_provider_status: String(subscription.status || 'unknown'),
      p_current_end: subscription.current_end ? new Date(subscription.current_end * 1000).toISOString() : null,
      p_event_created_at: Number.isSafeInteger(event.created_at) ? event.created_at : 0,
      p_payload: { event: event.event, subscription_id: subscription.id, status: subscription.status || 'unknown' }
    });
    if (subscription.notes?.referral_redemption_id && ['subscription.activated', 'subscription.charged'].includes(String(event.event))) {
      await rpc(config, 'redeem_slickly_referral', {
        p_redemption_id: String(subscription.notes.referral_redemption_id),
        p_provider_subscription_id: subscription.id
      });
    }
    return json(res, 200, { received: true, applied: Boolean(result?.applied ?? result) });
  } catch (error) {
    return safeError(res, error);
  }
};

module.exports.config = { api: { bodyParser: false } };
