'use strict';

async function main() {
  const rawUrl = String(process.env.SUPABASE_URL || '').trim().replace(/^["']|["']$/g, '');
  let supabaseUrl = '';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:' && parsed.hostname &&
        !parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
      supabaseUrl = parsed.origin;
    }
  } catch (_) {
    // Keep the failure message generic; never echo environment values.
  }
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const userId = process.env.SLICKLY_E2E_USER_ID || '';
  if (!userId) {
    console.log('No temporary Slickly CI user to clean up.');
    return;
  }
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Cannot clean up temporary Slickly CI user: valid HTTPS Supabase URL or service-role key is unavailable.');
  }
  const response = await fetch(supabaseUrl + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
    method: 'DELETE',
    headers: { apikey: serviceRoleKey, Authorization: 'Bearer ' + serviceRoleKey },
    signal: AbortSignal.timeout(15000)
  });
  if (![200, 204, 404].includes(response.status)) {
    const detail = await response.text();
    throw new Error('Temporary Slickly CI user cleanup failed (HTTP ' + response.status + '): ' + detail.slice(0, 300));
  }
  console.log(response.status === 404 ? 'PASS: temporary Slickly CI user was already absent; no email was sent.' : 'PASS: temporary Slickly CI user deleted; no email was sent.');
}

main().catch(error => {
  console.error('FAIL: Slickly CI user cleanup:', error.message);
  process.exitCode = 1;
});
