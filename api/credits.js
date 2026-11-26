'use strict';

const { json, authenticate, rpc, safeError } = require('./_lib/slickly-auth');

const FREE_DAILY_LIMITS = Object.freeze({
  screen_aware: 2,
  voice: 2,
  screenshot: 3,
  chat: 7
});

// Per-feature daily guardrails. All Pro features share one monthly allowance.
const PRO_DAILY_LIMITS = Object.freeze({
  screen_aware: 20,
  voice: 6,
  screenshot: 10,
  chat: 40
});

// Conservative relative weights for multimodal request cost.
// These are product units, not claims of exact provider-token billing.
const FEATURE_UNITS = Object.freeze({
  screen_aware: 3,
  voice: 4,
  screenshot: 3,
  chat: 1
});
const PRO_MONTHLY_BUDGET = 1000;

module.exports = async function credits(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { error: 'Use POST to check and consume a feature credit.' });
  }
  try {
    const { user, supabaseUrl, serviceRoleKey } = await authenticate(req);
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return json(res, 400, { error: 'Invalid JSON request.' }); }
    }
    const feature = body?.feature;
    if (!Object.prototype.hasOwnProperty.call(FREE_DAILY_LIMITS, feature)) {
      return json(res, 400, { error: 'Unknown feature. Choose screen_aware, voice, screenshot, or chat.' });
    }
    const result = await rpc(
      { supabaseUrl, serviceRoleKey },
      'consume_slickly_credit_v2',
      {
        p_user_id: user.id,
        p_feature: feature,
        p_free_daily_limit: FREE_DAILY_LIMITS[feature],
        p_pro_daily_limit: PRO_DAILY_LIMITS[feature],
        p_feature_units: FEATURE_UNITS[feature],
        p_pro_monthly_budget: PRO_MONTHLY_BUDGET
      }
    );
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || typeof row.allowed !== 'boolean') {
      return json(res, 503, { error: 'Slickly could not confirm your credit balance. No feature request was authorized.' });
    }
    const monthly = row.plan === 'pro' ? {
      used: Number(row.monthly_used) || 0,
      limit: Number(row.monthly_limit) || PRO_MONTHLY_BUDGET,
      remaining: Number(row.monthly_remaining) || 0
    } : null;
    if (!row.allowed) {
      const monthlyExhausted = row.limit_reason === 'monthly_budget';
      return json(res, 429, {
        error: monthlyExhausted
          ? 'Your 1,000 monthly Pro credits are used up. They reset at the start of next month.'
          : 'You have used today’s ' + feature.replace('_', ' ') + ' credits.',
        code: monthlyExhausted ? 'MONTHLY_BUDGET_EXHAUSTED' : 'DAILY_CREDITS_EXHAUSTED',
        feature,
        remaining: row.remaining,
        limit: row.daily_limit,
        resetsAt: row.resets_at,
        plan: row.plan,
        monthly
      });
    }
    return json(res, 200, {
      allowed: true,
      feature,
      remaining: row.remaining,
      used: row.used,
      limit: row.daily_limit,
      resetsAt: row.resets_at,
      plan: row.plan,
      monthly
    });
  } catch (error) {
    return safeError(res, error);
  }
};

module.exports.FREE_DAILY_LIMITS = FREE_DAILY_LIMITS;
module.exports.PRO_DAILY_LIMITS = PRO_DAILY_LIMITS;
module.exports.FEATURE_UNITS = FEATURE_UNITS;
module.exports.PRO_MONTHLY_BUDGET = PRO_MONTHLY_BUDGET;
