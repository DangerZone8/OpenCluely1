'use strict';

const models = ['gemini-3-flash-preview'];
const key = String(process.env.GEMINI_API_KEY || '').trim();
const timeoutMs = 20000;
const maxAttemptsPerModel = 2;
if (!key) {
  console.error('DIRECT GEMINI CHECK FAILED: GEMINI_API_KEY Actions secret is missing.');
  process.exit(1);
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const started = Date.now();
  let last = null;
  for (const model of models) {
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      const attemptStarted = Date.now();
      try {
        const response = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: 'Reply with exactly SLICKLY_DIRECT_GEMINI_OK' }] }],
              generationConfig: { maxOutputTokens: 32, temperature: 0 }
            }),
            signal: AbortSignal.timeout(timeoutMs)
          }
        );
        const body = await response.json().catch(() => ({}));
        const text = (body.candidates || []).flatMap(candidate => candidate.content?.parts || [])
          .map(part => typeof part.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim();
        const providerCode = typeof body.error?.status === 'string' ? body.error.status : null;
        console.log(JSON.stringify({
          model, attempt, status: response.status, ok: response.ok,
          durationMs: Date.now() - attemptStarted, providerCode,
          responseReceived: Boolean(text), responseMatches: text.includes('SLICKLY_DIRECT_GEMINI_OK'),
          message: typeof body.error?.message === 'string' ? body.error.message.slice(0, 180) : undefined
        }));
        if (response.ok && text) {
          console.log(JSON.stringify({ result: 'PASS', model, totalDurationMs: Date.now() - started }));
          return;
        }
        last = { model, status: response.status, providerCode };
        if ([401, 403, 429].includes(response.status) || providerCode === 'RESOURCE_EXHAUSTED') {
          console.error('Stopping direct Gemini retries on non-transient authentication/quota response.');
          break;
        }
        const transient = [500, 502, 503, 504].includes(response.status) ||
          ['UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED'].includes(providerCode);
        if (!transient) break;
      } catch (error) {
        const cause = error && error.cause ? error.cause : {};
        console.log(JSON.stringify({
          model, attempt, durationMs: Date.now() - attemptStarted, result: 'NETWORK_ERROR',
          errorName: error?.name || 'Error', errorCode: cause?.code || error?.code || null,
          causeName: cause?.name || null
        }));
        last = { model, errorCode: cause?.code || error?.code || error?.name || 'UNKNOWN' };
      }
      if (attempt < maxAttemptsPerModel) {
        console.log(JSON.stringify({ model, action: 'retry-transient-failure', delayMs: 1200 }));
        await sleep(1200);
      }
    }
    if ([401, 403, 429].includes(last?.status) || last?.providerCode === 'RESOURCE_EXHAUSTED') break;
  }
  console.error(JSON.stringify({ result: 'FAIL', totalDurationMs: Date.now() - started, last }));
  process.exitCode = 1;
}
main().catch(error => { console.error('DIRECT GEMINI CHECK CRASHED:', error?.name || 'Error'); process.exitCode = 1; });
