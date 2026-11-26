'use strict';

const assert = require('node:assert/strict');

async function main() {
  const site = String(process.env.SLICKLY_SITE_URL || 'https://slicklyai.vercel.app').replace(/\/$/, '');
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  const accessToken = String(process.env.SLICKLY_E2E_ACCESS_TOKEN || '');
  const userId = String(process.env.SLICKLY_E2E_USER_ID || '');

  assert.ok(/^https:\/\//i.test(site), 'SLICKLY_SITE_URL must be HTTPS.');
  assert.ok(/^https:\/\//i.test(supabaseUrl), 'SUPABASE_URL must be HTTPS.');
  assert.ok(serviceRoleKey.length > 20, 'SUPABASE_SERVICE_ROLE_KEY is missing.');
  assert.ok(accessToken.length > 20, 'Disposable CI user access token is missing.');
  assert.match(userId, /^[0-9a-f-]{36}$/i, 'Disposable CI user ID is invalid.');

  const subscriptionResponse = await fetch(
    supabaseUrl + '/rest/v1/slickly_subscriptions?on_conflict=user_id',
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: 'Bearer ' + serviceRoleKey,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify({
        user_id: userId,
        provider: 'razorpay',
        status: 'active',
        plan: 'pro',
        current_period_end: '2099-12-31T23:59:59.000Z'
      })
    }
  );
  if (!subscriptionResponse.ok) {
    const detail = (await subscriptionResponse.text()).slice(0, 500);
    throw new Error('Could not promote disposable CI user to temporary Pro status (HTTP ' +
      subscriptionResponse.status + '): ' + detail);
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
