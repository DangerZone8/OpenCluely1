'use strict';

const { json, authenticate, safeError } = require('../_lib/slickly-auth');

const LIMITS = {
  free: { screen_aware: 2, voice: 2, screenshot: 3, chat: 7 },
  pro: { screen_aware: 60, voice: 60, screenshot: 100, chat: 200 }
};

module.exports = async function accountMe(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Use GET to read your Slickly account.' });
  }
  try {
    const { user, supabaseUrl, serviceRoleKey } = await authenticate(req);
    const headers = { apikey: serviceRoleKey, Authorization: 'Bearer ' + serviceRoleKey };
    const today = new Date().toISOString().slice(0, 10);
    const base = supabaseUrl.replace(/\/$/, '') + '/rest/v1/';
    const [subResponse, usageResponse] = await Promise.all([
      fetch(base + 'slickly_subscriptions?select=plan,status,current_period_end&user_id=eq.' + encodeURIComponent(user.id), { headers }),
      fetch(base + 'slickly_usage_daily?select=feature,used,usage_date&user_id=eq.' + encodeURIComponent(user.id) + '&usage_date=eq.' + today, { headers })
    ]);
    if (!subResponse.ok || !usageResponse.ok) throw new Error('Could not load account entitlements.');
    const subscriptions = await subResponse.json();
    const usage = await usageResponse.json();
    const row = Array.isArray(subscriptions) ? subscriptions[0] : null;
    const active = row?.plan === 'pro' && row?.status === 'active' && row?.current_period_end && Date.parse(row.current_period_end) > Date.now();
    const plan = active ? 'pro' : 'free';
    const limits = LIMITS[plan];
    const used = Object.fromEntries((Array.isArray(usage) ? usage : []).map(item => [item.feature, Number(item.used) || 0]));
    const credits = Object.fromEntries(Object.entries(limits).map(([feature, limit]) => [feature, {
      used: used[feature] || 0,
      limit,
      remaining: Math.max(0, limit - (used[feature] || 0))
    }]));
    return json(res, 200, {
      user: { id: user.id, email: user.email || null },
      isReferralAdmin: String(process.env.SLICKLY_REFERRAL_ADMIN_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).includes(String(user.email || '').toLowerCase()),
      plan,
      subscription: row ? { status: row.status, currentPeriodEnd: row.current_period_end } : null,
      credits,
      resetsAt: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 1)).toISOString()
    });
  } catch (error) {
    return safeError(res, error);
  }
};
