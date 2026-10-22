'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const endpoint = process.env.OPENCLUELY_AI_ENDPOINT || 'https://opencluely-iota.vercel.app/api/gemini';
const installId = crypto.randomUUID();
// Tiny valid 1x1 PNG: exercises the same hosted vision payload shape as Capture Screen and Ask AI.
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=';

async function main() {
  let response;
  let raw;
  // A main-branch merge starts a new Vercel production deployment. Retry brief
  // configuration/rollout 503s so this gate tests the newly deployed endpoint.
  for (let attempt = 1; attempt <= 12; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-opencluely-install-id': installId
        },
        body: JSON.stringify({
          model: 'gemini-3.1-flash-lite',
          request: {
            contents: [{
              role: 'user',
              parts: [
                { text: 'This is an automated end-to-end screen-vision connectivity test. Briefly describe the image content, then include the word SCREEN_TEST_OK.' },
                { inlineData: { mimeType: 'image/png', data: image } }
              ]
            }],
            generationConfig: { temperature: 0, maxOutputTokens: 96 }
          }
        }),
        signal: controller.signal
      });
      raw = await response.text();
    } finally {
      clearTimeout(timer);
    }
    if (response.status !== 503 || attempt === 12) break;
    console.log('Hosted endpoint returned HTTP 503 during deployment/configuration check; retrying (' + attempt + '/12).');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  let result = {};
  try { result = JSON.parse(raw); } catch {}
  assert.equal(response.status, 200, 'Hosted screen-vision endpoint must return HTTP 200; body=' + String(raw).slice(0, 400));
  assert.equal(typeof result.text, 'string', 'Hosted vision endpoint must return text');
  assert.match(result.text, /SCREEN_TEST_OK/, 'Gemini response must contain the requested marker');
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
