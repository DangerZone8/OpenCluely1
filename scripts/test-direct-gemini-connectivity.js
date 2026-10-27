'use strict';

// Use the same supported Gemini model as the production handler. Prefer IPv4
// because some hosted runners resolve Google's API to an IPv6 route that stalls.
const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

const model = 'gemini-3.1-flash-lite';
const key = String(process.env.GEMINI_API_KEY || '').trim();
const timeoutMs = 35000;
const maxAttempts = 3;
const marker = 'SLICKLY_DIRECT_GEMINI_OK';

if (!key) {
  console.error('DIRECT GEMINI CHECK FAILED: GEMINI_API_KEY Actions secret is missing.');
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const started = Date.now();
  let last = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptStarted = Date.now();
    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with exactly ' + marker }] }],
            generationConfig: { maxOutputTokens: 32, temperature: 0 }
          }),
          signal: AbortSignal.timeout(timeoutMs)
        }
      );
      const body = await response.json().catch(() => ({}));
      const responseText = (body.candidates || [])
        .flatMap(candidate => candidate.content?.parts || [])
        .map(part => typeof part.text === 'string' ? part.text : '')
        .filter(Boolean).join('\\n').trim();
      const providerCode = typeof body.error?.status === 'string' ? body.error.status : null;

      console.log(JSON.stringify({
        model, attempt, status: response.status, ok: response.ok,
        durationMs: Date.now() - attemptStarted, providerCode,
        responseReceived: Boolean(responseText),
        responseMatches: responseText.includes(marker),
        message: typeof body.error?.message === 'string' ? body.error.message.slice(0, 180) : undefined
      }));

      if (response.ok && responseText.includes(marker)) {
        console.log(JSON.stringify({ result: 'PASS', model, totalDurationMs: Date.now() - started }));
        return;
      }

      last = { model, status: response.status, providerCode };
      // Auth, permission, quota and invalid-model responses are deterministic;
      // retrying them cannot repair the underlying credential/project setting.
      if ([400, 401, 403, 404, 429].includes(response.status) ||
          ['INVALID_ARGUMENT', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'RESOURCE_EXHAUSTED', 'NOT_FOUND'].includes(providerCode)) {
        break;
      }
      if (response.status < 500 && response.status !== 408) break;
    } catch (error) {
      const cause = error && error.cause ? error.cause : {};
      last = {
        model,
        errorCode: cause?.code || error?.code || error?.name || 'UNKNOWN',
        errorName: error?.name || 'Error'
      };
      console.log(JSON.stringify({
        model, attempt, durationMs: Date.now() - attemptStarted,
        result: 'NETWORK_ERROR',
        errorName: error?.name || 'Error',
        errorCode: cause?.code || error?.code || null,
        causeName: cause?.name || null
      }));
    }

    if (attempt < maxAttempts) {
      const delayMs = attempt * 1500;
      console.log(JSON.stringify({ model, action: 'retry-transient-failure', delayMs }));
      await sleep(delayMs);
    }
  }

  console.error(JSON.stringify({ result: 'FAIL', totalDurationMs: Date.now() - started, last }));
  process.exitCode = 1;
}

main().catch(error => {
  console.error('DIRECT GEMINI CHECK CRASHED:', error?.name || 'Error');
  process.exitCode = 1;
});
