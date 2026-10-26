'use strict';

// Production diagnostic for the reported ~2-minute screen-AI failure.
// Makes bounded real requests to the hosted API, logs classification per attempt,
// and runs long enough to distinguish sustained failure from a single transient.
const crypto = require('node:crypto');

const endpoint = process.env.SLICKLY_DIAGNOSTIC_ENDPOINT || 'https://cleverly-lime.vercel.app/api/gemini';
const durationMs = Number(process.env.SLICKLY_DIAGNOSTIC_DURATION_MS || 150000);
const intervalMs = Number(process.env.SLICKLY_DIAGNOSTIC_INTERVAL_MS || 8000);
const expectedRevision = process.env.SLICKLY_EXPECTED_API_REVISION || 'v175-fast-chat-2026-10-27-j';
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=';

function classify(status, body) {
  const code = String(body?.providerCode || body?.code || '').toUpperCase();
  const message = String(body?.providerMessage || body?.error || body?.message || '').toLowerCase();
  if (status === 429 || code === 'RESOURCE_EXHAUSTED' || /quota|rate.?limit|usage limit/.test(message)) return 'QUOTA_OR_RATE_LIMIT';
  if (code === 'NETWORK_OR_TIMEOUT' || /timed out|timeout|could not be reached|network/.test(message) || [502, 503, 504].includes(status)) return 'UPSTREAM_TIMEOUT_OR_5XX';
  if (status === 200 && typeof body?.text === 'string' && body.text.trim()) return 'OK';
  return 'OTHER_FAILURE';
}

async function request(feature, index) {
  const request = feature === 'screen-vision'
    ? { contents: [{ role: 'user', parts: [
        { text: 'Automated sustained screen-vision diagnostic. Briefly describe this test image.' },
        { inlineData: { mimeType: 'image/png', data: image } }
      ] }], generationConfig: { temperature: 0, maxOutputTokens: 48 } }
    : { contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: SLICKLY_CHAT_OK' }] }], generationConfig: { temperature: 0, maxOutputTokens: 24 } };
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-opencluely-install-id': crypto.randomUUID(),
        'x-opencluely-feature': feature,
        ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET
          ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET }
          : {})
      },
      body: JSON.stringify({ model: 'gemini-3-flash-preview', request }),
      signal: AbortSignal.timeout(30000)
    });
    const raw = await response.text();
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const revision = response.headers.get('x-opencluely-api-revision');
    const result = {
      attempt: index, feature, status: response.status,
      classification: classify(response.status, body),
      durationMs: Date.now() - started, revision,
      providerStatus: body.providerStatus ?? null,
      providerCode: body.providerCode ?? null,
      retryAfter: response.headers.get('retry-after'),
      message: String(body.providerMessage || body.error || body.text || raw).replace(/\s+/g, ' ').slice(0, 180)
    };
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    const result = { attempt: index, feature, status: 0, classification: 'CLIENT_NETWORK_OR_TIMEOUT', durationMs: Date.now() - started, message: String(error.message).slice(0, 180) };
    console.log(JSON.stringify(result));
    return result;
  }
}

async function main() {
  console.log(JSON.stringify({ event: 'start', endpoint, durationMs, intervalMs, expectedRevision }));
  const started = Date.now();
  const results = [];
  let index = 0;
  // Start with a text control request, then alternate vision and text to see
  // whether only vision fails or the shared provider path fails for both.
  results.push(await request('chat', ++index));
  let nextVision = true;
  while (Date.now() - started < durationMs && !results.some(item => item.classification === 'QUOTA_OR_RATE_LIMIT')) {
    const feature = nextVision ? 'screen-vision' : 'chat';
    const result = await request(feature, ++index);
    results.push(result);
    if (result.classification === 'QUOTA_OR_RATE_LIMIT') {
      console.error('Stopping diagnostic immediately: provider quota/rate limit is exhausted; further calls would waste requests without adding diagnostic value.');
      break;
    }
    nextVision = !nextVision;
    const remaining = durationMs - (Date.now() - started);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
  const counts = {};
  for (const item of results) counts[item.classification] = (counts[item.classification] || 0) + 1;
  const vision = results.filter(item => item.feature === 'screen-vision');
  const chat = results.filter(item => item.feature === 'chat');
  const revisionMismatch = results.filter(item => item.revision !== expectedRevision).length;
  console.log(JSON.stringify({
    event: 'summary', elapsedMs: Date.now() - started, total: results.length,
    counts, visionTotal: vision.length, visionOk: vision.filter(x => x.classification === 'OK').length,
    chatTotal: chat.length, chatOk: chat.filter(x => x.classification === 'OK').length,
    revisionMismatch, result: results.every(x => x.classification === 'OK') && revisionMismatch === 0 ? 'PASS' : 'FAIL'
  }));
  if (!results.every(x => x.classification === 'OK') || revisionMismatch) process.exitCode = 1;
}
main().catch(error => { console.error('DIAGNOSTIC_FATAL:', error.stack || error.message); process.exitCode = 1; });
