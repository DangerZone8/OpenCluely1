'use strict';

const { json, authenticate, rpc, safeError } = require('./_lib/slickly-auth');

// Free daily allowance. Each successful feature invocation consumes one credit.
// These are enforced by a single Postgres transaction, not renderer/local state.
const FREE_DAILY_LIMITS = Object.freeze({
  screen_aware: 2,
  voice: 2,
  screenshot: 3,
  chat: 7
});
const PRO_DAILY_LIMITS = Object.freeze({
  screen_aware: 60,
  voice: 60,
  screenshot: 100,
  chat: 200
});

module.exports = async function credits(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Use POST to check and consume a feature credit.' });
  }
  try {
    const { user } = await authenticate(req);
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON request.' }); }
    }
    const feature = body?.feature;
    if (!Object.prototype.hasOwnProperty.call(FREE_DAILY_LIMITS, feature)) {
      return json(res, 400, { error: 'Unknown feature. Choose screen_aware, voice, screenshot, or chat.' });
    }
    const result = await rpc(
      { supabaseUrl: process.env.SUPABASE_URL.replace(/\/$/, ''), serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY },
      'consume_slickly_credit',
      {
        p_user_id: user.id,
        p_feature: feature,
        p_free_limit: FREE_DAILY_LIMITS[feature],
        p_pro_limit: PRO_DAILY_LIMITS[feature]
      }
    );
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || typeof row.allowed !== 'boolean') {
      return json(res, 503, { error: 'Slickly could not confirm your credit balance. No feature request was authorized.' });
    }
    if (!row.allowed) {
      return json(res, 429, {
        error: 'You have used today’s ' + feature.replace('_', ' ') + ' credits.',
        code: 'DAILY_CREDITS_EXHAUSTED',
        feature,
        remaining: 0,
        limit: row.daily_limit,
        resetsAt: row.resets_at,
        plan: row.plan
      });
    }
    return json(res, 200, {
      allowed: true,
      feature,
      remaining: row.remaining,
      used: row.used,
      limit: row.daily_limit,
      resetsAt: row.resets_at,
      plan: row.plan
    });
  } catch (error) {
    return safeError(res, error);
  }
};

module.exports.FREE_DAILY_LIMITS = FREE_DAILY_LIMITS;
module.exports.PRO_DAILY_LIMITS = PRO_DAILY_LIMITS;
