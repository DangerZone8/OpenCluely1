'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');

async function main() {
  const rawSupabaseUrl = String(process.env.SUPABASE_URL || '').trim();
  let supabaseUrl = '';
  try {
    const parsed = new URL(rawSupabaseUrl);
    if (parsed.protocol === 'https:' && parsed.hostname && !parsed.username && !parsed.password &&
        (!parsed.pathname || parsed.pathname === '/') && !parsed.search && !parsed.hash) {
      supabaseUrl = parsed.origin;
    }
  } catch {}
  const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error('Invalid/missing GitHub Actions Supabase configuration (safe diagnostics only): ' +
      JSON.stringify({
        SUPABASE_URL_present: Boolean(rawSupabaseUrl),
        SUPABASE_URL_valid_https_origin: Boolean(supabaseUrl),
        SUPABASE_ANON_KEY_present: Boolean(process.env.SUPABASE_ANON_KEY),
        SUPABASE_PUBLISHABLE_KEY_present: Boolean(process.env.SUPABASE_PUBLISHABLE_KEY),
        usable_public_key_present: Boolean(anonKey),
        SUPABASE_SERVICE_ROLE_KEY_present: Boolean(serviceRoleKey)
      }) + '. No secret values, personal test email, or password are logged.');
  }

  const email = 'slickly-ci-' + (process.env.GITHUB_RUN_ID || 'local') + '-' +
    (process.env.GITHUB_RUN_ATTEMPT || '1') + '-' + crypto.randomUUID() + '@example.com';
  const password = crypto.randomBytes(36).toString('base64url');

  const adminResponse = await fetch(supabaseUrl + '/auth/v1/admin/users', {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: 'Bearer ' + serviceRoleKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { slickly_ci_test: true }
    }),
    signal: AbortSignal.timeout(15000)
  });
  const created = await adminResponse.json().catch(() => ({}));
  const userId = created.id || created.user?.id;
  if (!adminResponse.ok || typeof userId !== 'string') {
    throw new Error('Could not create an email-confirmed temporary CI user without sending email (HTTP ' +
      adminResponse.status + '): ' + (created.message || created.msg || created.error_description || 'Supabase Admin API rejected the request.'));
  }

  try {
    const authUrl = new URL('/auth/v1/token', supabaseUrl);
    authUrl.searchParams.set('grant_type', 'password');
    const authResponse = await fetch(authUrl, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15000)
    });
    const session = await authResponse.json().catch(() => ({}));
    if (!authResponse.ok || typeof session.access_token !== 'string' || !session.access_token) {
      throw new Error('Temporary CI user could not obtain a session (HTTP ' + authResponse.status + '): ' +
        (session.msg || session.error_description || session.message || 'Supabase password sign-in failed.'));
    }
    if (!process.env.GITHUB_ENV) {
      throw new Error('GITHUB_ENV is unavailable; refusing to print the temporary access token.');
    }
    fs.appendFileSync(process.env.GITHUB_ENV,
      'SLICKLY_E2E_ACCESS_TOKEN=' + session.access_token + '\n' +
      'SLICKLY_E2E_USER_ID=' + userId + '\n',
      { mode: 0o600 });
    console.log('PASS: created a temporary confirmed CI user with the Supabase Admin API; no confirmation email was sent and credentials were not logged.');
  } catch (error) {
    await fetch(supabaseUrl + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
      method: 'DELETE',
      headers: { apikey: serviceRoleKey, Authorization: 'Bearer ' + serviceRoleKey },
      signal: AbortSignal.timeout(10000)
    }).catch(() => {});
    throw error;
  }
}

main().catch(error => {
  console.error('FAIL: Slickly temporary CI session:', error.message);
  process.exitCode = 1;
});
