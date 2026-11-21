'use strict';

const assert = require('node:assert/strict');

async function main() {
  const site = new URL(process.env.SLICKLY_SITE_URL || 'https://slicklyai.vercel.app');
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
  const requestHeaders = bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {};
  const configResponse = await fetch(new URL('/api/public-config', site), { headers: requestHeaders, cache: 'no-store' });
  const configText = await configResponse.text();
  let config = {};
  try { config = JSON.parse(configText); } catch (_) {}
  const configDiagnostic = typeof config.error === 'string'
    ? config.error
    : 'response keys=' + Object.keys(config).sort().join(',') + ', content-type=' + String(configResponse.headers.get('content-type') || 'unknown') + ', bytes=' + configText.length;
  assert.equal(configResponse.status, 200,
    'Live Slickly public config returned HTTP ' + configResponse.status + ' (' + configDiagnostic + '); missing Vercel variables: ' + JSON.stringify(config.missing || []) + '. Check SUPABASE_URL and SUPABASE_ANON_KEY/SUPABASE_PUBLISHABLE_KEY.');
  let supabaseOrigin = null;
  try {
    const parsed = new URL(config.supabaseUrl || '');
    if (parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password &&
        parsed.pathname === '/' && !parsed.search && !parsed.hash) {
      supabaseOrigin = parsed.origin;
    }
  } catch (_) {}
  assert.ok(supabaseOrigin,
    'Live public config must expose an HTTPS Supabase project origin (custom Supabase domains are supported).');
  assert.ok(typeof config.supabaseAnonKey === 'string' && config.supabaseAnonKey.length >= 20,
    'Live public config must expose the Supabase public anon/publishable key.');
  assert.equal(JSON.stringify(config).includes('SUPABASE_SERVICE_ROLE_KEY'), false,
    'Public config must never expose the service-role key.');

  const accountProbe = await fetch(new URL('/api/account/me', site), { headers: requestHeaders, cache: 'no-store' });
  assert.equal(accountProbe.status, 401,
    'Slickly account API must be configured and reject an unsigned request with HTTP 401 (not 503). This also verifies SUPABASE_SERVICE_ROLE_KEY is present.');

  const settingsResponse = await fetch(new URL('/auth/v1/settings', config.supabaseUrl), {
    headers: { apikey: config.supabaseAnonKey },
    cache: 'no-store'
  });
  assert.equal(settingsResponse.status, 200, 'Supabase Auth settings must be readable for sign-in verification.');
  const settings = await settingsResponse.json();
  assert.equal(settings.external?.email, true, 'Supabase email/password sign-in provider must be enabled.');
  assert.equal(settings.mailer_autoconfirm, true,
    'Supabase Confirm email must be disabled (auto-confirm enabled) so email/password signup returns an active session.');
  assert.notEqual(settings.disable_signup, true, 'Supabase must allow new account signups.');

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
