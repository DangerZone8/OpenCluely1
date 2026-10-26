'use strict';

const models = ['gemini-3.8-flash', 'gemini-3.5-flash-lite'];
const key = String(process.env.GEMINI_API_KEY || '').trim();

if (!key) {
  console.error('DIRECT GEMINI CHECK FAILED: GEMINI_API_KEY Actions secret is missing.');
  process.exit(1);
}

async function main() {
  const started = Date.now();
  let last = null;
  for (const model of models) {
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
          signal: AbortSignal.timeout(15000)
        }
      );
      const body = await response.json().catch(() => ({}));
      const text = (body.candidates || [])
        .flatMap(candidate => candidate.content?.parts || [])
        .map(part => typeof part.text === 'string' ? part.text : '')
        .filter(Boolean)
        .join('\n').trim();
      const providerCode = typeof body.error?.status === 'string' ? body.error.status : null;
      console.log(JSON.stringify({
        model, status: response.status, ok: response.ok,
        durationMs: Date.now() - attemptStarted, providerCode,
        responseReceived: Boolean(text),
        responseMatches: text.includes('SLICKLY_DIRECT_GEMINI_OK'),
        message: typeof body.error?.message === 'string' ? body.error.message.slice(0, 180) : undefined
      }));
      if (response.ok && text) {
        console.log(JSON.stringify({ result: 'PASS', model, totalDurationMs: Date.now() - started }));
        return;
      }
      last = { model, status: response.status, providerCode };
      if (response.status === 401 || response.status === 403 || providerCode === 'RESOURCE_EXHAUSTED') break;
    } catch (error) {
      const cause = error && error.cause ? error.cause : {};
      console.log(JSON.stringify({
        model, durationMs: Date.now() - attemptStarted,
        result: 'NETWORK_ERROR',
        errorName: error?.name || 'Error',
        errorCode: cause?.code || error?.code || null,
        causeName: cause?.name || null
      }));
      last = { model, errorCode: cause?.code || error?.code || error?.name || 'UNKNOWN' };
    }
  }
  console.error(JSON.stringify({ result: 'FAIL', totalDurationMs: Date.now() - started, last }));
  process.exitCode = 1;
}

main().catch(error => {
  console.error('DIRECT GEMINI CHECK CRASHED:', error?.name || 'Error');
  process.exitCode = 1;
});
