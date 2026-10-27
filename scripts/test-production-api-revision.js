'use strict';

const endpoint = process.env.VERIFY_ONLY_ENDPOINT || 'https://slicklyai.vercel.app/api/gemini';
const expected = process.env.SLICKLY_EXPECTED_API_REVISION || 'v175-fast-chat-2026-10-27-m';

async function main() {
  const headers = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
    ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
    : {};
  const response = await fetch(endpoint, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(10000)
  });
  const actual = response.headers.get('x-opencluely-api-revision');
  // The handler intentionally returns 405 to GET; its revision header is still
  // the deployment fingerprint. Do not make a Gemini call in this check.
  if (actual !== expected) {
    throw new Error('Production API revision mismatch: expected ' + expected +
      ', received ' + String(actual) + ' (HTTP ' + response.status + ').');
  }
  if (response.status !== 405) {
    throw new Error('Expected GET probe to return HTTP 405 without invoking Gemini; got HTTP ' + response.status + '.');
  }
  console.log('PASS: production API revision is ' + actual + '; GET probe did not consume Gemini quota.');
}

main().catch(error => {
  console.error('PRODUCTION API REVISION CHECK FAILED:', error.message);
  process.exitCode = 1;
});
