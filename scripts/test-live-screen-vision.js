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
  const expectedRevision = 'quota-guard-2026-10-22-a';
  let revision = null;\n  let endpoint = null;

  // Poll with GET first. This endpoint responds 405 for GET but includes the
  // deployed revision header, allowing rollout checks without spending Gemini quota.
  for (const candidate of endpoints) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const probe = await fetch(candidate, { method: 'GET', signal: AbortSignal.timeout(8000) });
        const candidateRevision = probe.headers.get('x-opencluely-api-revision');
        if (candidateRevision === expectedRevision) {
          endpoint = candidate;
          revision = candidateRevision;
          break;
        }
        console.log('Hosted API ' + candidate + ' has revision ' + String(candidateRevision) + ' (attempt ' + attempt + '/3).');
      } catch (error) {
        console.log('Hosted API probe failed for ' + candidate + ' (' + error.message + '), attempt ' + attempt + '/3.');
      }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 2000));
    }
    if (endpoint) break;
  }
  assert.ok(endpoint, 'No hosted endpoint serves expected API revision ' + expectedRevision + '; checked: ' + endpoints.join(', '));

  // Make exactly one real provider-backed request. Retrying quota exhaustion
  // would not repair the account quota and would consume additional requests.
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-opencluely-install-id': installId
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
    signal: AbortSignal.timeout(20000)
  });
  const raw = await response.text();
  let result = {};
  try { result = JSON.parse(raw); } catch {}
  const apiRevision = response.headers.get('x-opencluely-api-revision');
  assert.equal(apiRevision, expectedRevision, 'API revision changed during live test; revision=' + String(apiRevision));
  assert.equal(response.status, 200, 'Hosted screen-vision endpoint must return HTTP 200; API revision=' + String(apiRevision) + '; actual HTTP=' + response.status + '; body=' + String(raw).slice(0, 400));
  assert.equal(typeof result.text, 'string', 'Hosted vision endpoint must return text');
  assert.ok(result.text.trim().length > 0, 'Gemini vision request must return a non-empty description');
  console.log('PASS: live hosted screen-vision E2E; HTTPS POST, installation ID, Vercel proxy, Gemini vision request and response all succeeded.');
  console.log('Endpoint:', endpoint);
  console.log('HTTP:', response.status);
  console.log('Model:', result.model || 'server default');
  console.log('Response:', result.text.slice(0, 300));
}

main().catch(error => {
  console.error('LIVE SCREEN-VISION E2E FAILED:', error.message);
  process.exitCode = 1;
});
