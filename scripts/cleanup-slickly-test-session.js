'use strict';

async function main() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const userId = process.env.SLICKLY_E2E_USER_ID || '';
  if (!userId) {
    console.log('No temporary Slickly CI user to clean up.');
    return;
  }
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(supabaseUrl) || !serviceRoleKey) {
    throw new Error('Cannot clean up temporary Slickly CI user: Supabase URL or service-role key is unavailable.');
  }
  const response = await fetch(supabaseUrl + '/auth/v1/admin/users/' + encodeURIComponent(userId), {
    method: 'DELETE',
    headers: { apikey: serviceRoleKey, Authorization: 'Bearer ' + serviceRoleKey },
    signal: AbortSignal.timeout(15000)
  });
  if (![200, 204].includes(response.status)) {
    const detail = await response.text();
    throw new Error('Temporary Slickly CI user cleanup failed (HTTP ' + response.status + '): ' + detail.slice(0, 300));
  }
  console.log('PASS: temporary Slickly CI user deleted; no email was sent.');
}

main().catch(error => {
  console.error('FAIL: Slickly CI user cleanup:', error.message);
  process.exitCode = 1;
});
