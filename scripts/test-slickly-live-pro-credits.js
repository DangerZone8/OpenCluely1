'use strict';

const assert = require('node:assert/strict');

async function main() {
  const site = String(process.env.SLICKLY_SITE_URL || 'https://slicklyai.vercel.app').replace(/\/$/, '');
  const rawSupabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/^["']|["']$/g, '');
  let supabaseUrl = '';
  try {
    const parsedSupabaseUrl = new URL(rawSupabaseUrl);
    if (parsedSupabaseUrl.protocol === 'https:' && parsedSupabaseUrl.hostname &&
        !parsedSupabaseUrl.username && !parsedSupabaseUrl.password &&
        !parsedSupabaseUrl.search && !parsedSupabaseUrl.hash) {
      supabaseUrl = parsedSupabaseUrl.origin;
    }
  } catch {}
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  const accessToken = String(process.env.SLICKLY_E2E_ACCESS_TOKEN || '');
  const userId = String(process.env.SLICKLY_E2E_USER_ID || '');

  assert.ok(/^https:\/\//i.test(site), 'SLICKLY_SITE_URL must be HTTPS.');
  assert.ok(/^https:\/\//i.test(supabaseUrl), 'SUPABASE_URL must be HTTPS.');
  assert.ok(serviceRoleKey.length > 20, 'SUPABASE_SERVICE_ROLE_KEY is missing.');
  assert.ok(accessToken.length > 20, 'Disposable CI user access token is missing.');
  assert.match(userId, /^[0-9a-f-]{36}$/i, 'Disposable CI user ID is invalid.');

  // Provision only the disposable CI identity directly in the entitlement table.
  // This tests production entitlement recognition without depending on a billing
  // webhook/RPC route (the CI test is not a Razorpay webhook test).
  const subscriptionUrl = supabaseUrl + '/rest/v1/slickly_subscriptions?on_conflict=user_id';
  const subscriptionResponse = await fetch(subscriptionUrl, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: 'Bearer ' + serviceRoleKey,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation'
    },
    body: JSON.stringify({
      user_id: userId,
      provider: 'ci',
      provider_subscription_id: 'ci-sub-' + userId,
      status: 'active',
      plan: 'pro',
      current_period_end: '2099-12-31T23:59:59.000Z',
      provider_event_created_at: Math.floor(Date.now() / 1000)
    })
  });
  const subscriptionBody = await subscriptionResponse.json().catch(() => ({}));
  if (!subscriptionResponse.ok) {
    throw new Error('Could not provision disposable CI Pro entitlement (HTTP ' +
      subscriptionResponse.status + '): ' + JSON.stringify(subscriptionBody).slice(0, 500));
  }
  const verifyResponse = await fetch(
    supabaseUrl + '/rest/v1/slickly_subscriptions?select=user_id,plan,status,current_period_end&user_id=eq.' + encodeURIComponent(userId),
    { headers: { apikey: serviceRoleKey, Authorization: 'Bearer ' + serviceRoleKey } }
  );
  const verifiedRows = await verifyResponse.json().catch(() => []);
  if (!verifyResponse.ok || !Array.isArray(verifiedRows) || !verifiedRows.some(row =>
    row.user_id === userId && row.plan === 'pro' && row.status === 'active' &&
    Date.parse(row.current_period_end) > Date.now())) {
    throw new Error('Disposable CI Pro entitlement could not be verified (HTTP ' +
      verifyResponse.status + '): ' + JSON.stringify(verifiedRows).slice(0, 500));
  }

  const expected = [
    { feature: 'chat', units: 1, dailyLimit: 40 },
    { feature: 'screen_aware', units: 3, dailyLimit: 20 },
    { feature: 'voice', units: 4, dailyLimit: 6 },
    { feature: 'screenshot', units: 3, dailyLimit: 10 }
  ];
  let totalUsed = 0;

  for (const item of expected) {
    totalUsed += item.units;
    const response = await fetch(site + '/api/credits', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + accessToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ feature: item.feature })
    });
    const data = await response.json().catch(() => ({}));
    assert.equal(response.status, 200,
      item.feature + ' Pro credit request must return HTTP 200: ' + JSON.stringify(data));
    assert.equal(data.allowed, true, item.feature + ' Pro credit request must be allowed.');
    assert.equal(data.plan, 'pro', item.feature + ' must be recognized as Pro.');
    assert.equal(data.limit, item.dailyLimit, item.feature + ' daily guardrail must match.');
    assert.equal(data.monthly?.limit, 1000, 'Pro monthly budget must be exactly 1,000 credits.');
    assert.equal(data.monthly?.used, totalUsed,
      'Monthly usage must accumulate the configured weight for ' + item.feature + '.');
    assert.equal(data.monthly?.remaining, 1000 - totalUsed,
      'Monthly remaining credits must match the accumulated weighted usage.');
  }

  console.log('PASS: live Pro subscription recognition, 1,000-credit monthly budget, and chat/screen/voice/screenshot weights (1/3/4/3) verified against production Supabase.');
}

main().catch(error => {
  console.error('LIVE PRO CREDIT TEST FAILED:', error.message);
  process.exitCode = 1;
});
