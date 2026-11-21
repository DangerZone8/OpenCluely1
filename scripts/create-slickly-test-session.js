'use strict';

const fs = require('node:fs');

async function main() {
  const email = process.env.SLICKLY_TEST_EMAIL;
  const password = process.env.SLICKLY_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error('Configure repository Actions secrets SLICKLY_TEST_EMAIL and SLICKLY_TEST_PASSWORD for authenticated production AI checks.');
  }

  const site = new URL(process.env.SLICKLY_SITE_URL || 'https://slicklyai.vercel.app');
  const configResponse = await fetch(new URL('/api/public-config', site), {
    cache: 'no-store',
    signal: AbortSignal.timeout(10000)
  });
  const config = await configResponse.json().catch(() => ({}));
  if (!configResponse.ok || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error('Could not obtain public Supabase configuration for the CI test account (HTTP ' + configResponse.status + ').');
  }

  const authUrl = new URL('/auth/v1/token', config.supabaseUrl);
  authUrl.searchParams.set('grant_type', 'password');
  const response = await fetch(authUrl, {
    method: 'POST',
    headers: {
      apikey: config.supabaseAnonKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15000)
  });
  const session = await response.json().catch(() => ({}));
  if (!response.ok || typeof session.access_token !== 'string' || !session.access_token) {
    const reason = typeof session.msg === 'string' ? session.msg :
      typeof session.error_description === 'string' ? session.error_description :
      typeof session.message === 'string' ? session.message : 'Supabase password sign-in was rejected.';
    throw new Error('Could not sign in the Slickly CI test account (HTTP ' + response.status + '): ' + reason);
  }

  if (!process.env.GITHUB_ENV) {
    throw new Error('GITHUB_ENV is unavailable; refusing to print the temporary access token.');
  }
  fs.appendFileSync(process.env.GITHUB_ENV, 'SLICKLY_E2E_ACCESS_TOKEN=' + session.access_token + '\n', { mode: 0o600 });
  console.log('PASS: authenticated Slickly CI test session prepared; access token was kept out of logs.');
}

main().catch(error => {
  console.error('FAIL: Slickly CI test-account sign-in:', error.message);
  process.exitCode = 1;
});
