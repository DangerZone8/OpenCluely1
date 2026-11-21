'use strict';

const assert = require('node:assert/strict');

async function main() {
  const site = new URL(process.env.SLICKLY_SITE_URL || 'https://slicklyai.vercel.app');
  const configResponse = await fetch(new URL('/api/public-config', site), { cache: 'no-store' });
  const config = await configResponse.json().catch(() => ({}));
  assert.equal(configResponse.status, 200,
    'Live Slickly public config must return HTTP 200; check Vercel SUPABASE_URL and SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY.');
  assert.match(config.supabaseUrl || '', /^https:\/\/[a-z0-9.-]+\.supabase\.co$/i,
    'Live public config must expose a valid Supabase project URL.');
  assert.ok(typeof config.supabaseAnonKey === 'string' && config.supabaseAnonKey.length >= 20,
    'Live public config must expose the Supabase public anon/publishable key.');
  assert.equal(JSON.stringify(config).includes('SUPABASE_SERVICE_ROLE_KEY'), false,
    'Public config must never expose the service-role key.');

  async function verifyGoogleRedirect(redirectTo, label) {
    const authorize = new URL('/auth/v1/authorize', config.supabaseUrl);
    authorize.searchParams.set('provider', 'google');
    authorize.searchParams.set('redirect_to', redirectTo);
    const response = await fetch(authorize, {
      headers: { apikey: config.supabaseAnonKey },
      redirect: 'manual'
    });
    const location = response.headers.get('location');
    assert.ok([302, 303].includes(response.status) && location,
      'Supabase Google OAuth must be enabled and accept the ' + label + ' redirect (HTTP ' + response.status + ').');
    const destination = new URL(location);
    assert.match(destination.hostname, /(^|\.)google\.com$/i,
      'Supabase ' + label + ' OAuth must redirect to Google, not an error or unrelated host.');
  }

  await verifyGoogleRedirect(new URL('/account.html', site).toString(), 'website');
  await verifyGoogleRedirect('slickly://auth/callback', 'desktop app');
  console.log('PASS: live Slickly public Supabase config is available and Google OAuth accepts website and desktop callback URLs.');
}

main().catch(error => {
  console.error('FAIL: live Slickly sign-in verification:', error.message);
  process.exitCode = 1;
});
