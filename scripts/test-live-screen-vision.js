'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const endpoints = [...new Set([
  process.env.OPENCLUELY_AI_ENDPOINT,
  'https://opencluely-iota.vercel.app/api/gemini',
  process.env.OPENCLUELY_AI_FALLBACK_ENDPOINT,
  'https://opencluelys.vercel.app/api/gemini'
].filter(value => typeof value === 'string' && value.trim()))];
const installId = crypto.randomUUID();
// Tiny valid 1x1 PNG: exercises the same hosted vision payload shape as Capture Screen and Ask AI.
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=';

async function main() {
  const expectedRevisions = new Set(['v175-fast-chat-2026-10-25-e']);
  if (process.env.ALLOW_OLD_API_REVISION === 'true') {
    expectedRevisions.add('v175-fast-chat-2026-10-25-d');
  }
  const expectedRevisionLabel = [...expectedRevisions].join(' or ');
  const failures = [];

  // Try every configured hosted endpoint end-to-end. A correctly-versioned but
  // misconfigured deployment must not prevent a healthy fallback from being tested.
  for (const candidate of endpoints) {
    let revision = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const probe = await fetch(candidate, { method: 'GET', signal: AbortSignal.timeout(8000) });
        revision = probe.headers.get('x-opencluely-api-revision');
        if (expectedRevisions.has(revision)) break;
        console.log('Hosted API ' + candidate + ' has revision ' + String(revision) + ' (attempt ' + attempt + '/3).');
      } catch (error) {
        console.log('Hosted API probe failed for ' + candidate + ' (' + error.message + '), attempt ' + attempt + '/3.');
      }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (!expectedRevisions.has(revision)) {
      failures.push(candidate + ': expected revision ' + expectedRevisionLabel + ', got ' + String(revision));
      continue;
    }

    // Exactly one provider-backed request per candidate. Never retry quota exhaustion.
    const installId = crypto.randomUUID();
    const response = await fetch(candidate, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-opencluely-install-id': installId,
        'x-opencluely-feature': 'screen-vision'
      },
      body: JSON.stringify({
        model: 'gemini-3.5-flash-lite',
        request: {
          contents: [{
            role: 'user',
            parts: [
              { text: 'This is an automated end-to-end screen-vision test. Briefly describe any visual content you can infer from the attached image in one sentence.' },
              { inlineData: { mimeType: 'image/png', data: image } }
            ]
          }],
          generationConfig: { temperature: 0, maxOutputTokens: 96 }
        }
      }),
      signal: AbortSignal.timeout(25000)
    });
    const raw = await response.text();
    let result = {};
    try { result = JSON.parse(raw); } catch {}
    const apiRevision = response.headers.get('x-opencluely-api-revision');
    if (!expectedRevisions.has(apiRevision) || response.status !== 200 ||
        typeof result.text !== 'string' || !result.text.trim()) {
      const failure = candidate + ': revision=' + String(apiRevision) +
        ', HTTP=' + response.status + ', body=' + String(raw).slice(0, 400);
      failures.push(failure);
      console.error('Hosted screen-vision endpoint failed: ' + failure);
      continue;
    }

    console.log('PASS: live hosted screen-vision E2E; HTTPS POST, installation ID, Vercel proxy, Gemini vision request and response all succeeded.');
    console.log('Endpoint:', candidate);
    console.log('HTTP:', response.status);
    console.log('Model:', result.model || 'server default');
    console.log('Response:', result.text.slice(0, 300));
    return;
  }

  throw new Error('No configured hosted endpoint passed live screen-vision E2E. ' + failures.join(' | '));
}
main().catch(error => {
  console.error('LIVE SCREEN-VISION E2E FAILED:', error.message);
  process.exitCode = 1;
});
