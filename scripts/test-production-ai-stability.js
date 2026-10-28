'use strict';

// Required production stability gate. External dependency failures are reported
// separately from likely application/API regressions, but every failed probe
// still fails this gate. Never turn a red stability result green just because
// the provider or hosting platform appears to be the cause.
const crypto = require('node:crypto');
const fs = require('node:fs');

const endpoint = process.env.SLICKLY_DIAGNOSTIC_ENDPOINT || 'https://cleverly-lime.vercel.app/api/gemini';
const durationMs = Number(process.env.SLICKLY_DIAGNOSTIC_DURATION_MS || 150000);
const intervalMs = Number(process.env.SLICKLY_DIAGNOSTIC_INTERVAL_MS || 8000);
const expectedRevision = process.env.SLICKLY_EXPECTED_API_REVISION || 'v175-fast-chat-2026-10-27-k';
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=';

function classify(status, body) {
  const code = String(body?.providerCode || body?.code || '').toUpperCase();
  const message = String(body?.providerMessage || body?.error || body?.message || '').toLowerCase();
  if (status === 429 || code === 'RESOURCE_EXHAUSTED' || /quota|rate.?limit|usage limit/.test(message)) return 'EXTERNAL_QUOTA_OR_RATE_LIMIT';
  if (code === 'NETWORK_OR_TIMEOUT' || /timed out|timeout|could not be reached|network|temporarily unavailable|high demand/.test(message) || [502, 503, 504].includes(status)) return 'EXTERNAL_UPSTREAM_OR_HOSTING_FAILURE';
  if (status === 0) return 'EXTERNAL_RUNNER_NETWORK_FAILURE';
  if ([401, 403, 404].includes(status)) return 'API_CONFIGURATION_OR_ROUTING_FAILURE';
  if (status === 200 && typeof body?.text === 'string' && body.text.trim()) return 'OK';
  if (status >= 500) return 'EXTERNAL_OR_UNCLASSIFIED_SERVER_FAILURE';
  return 'API_CONTRACT_OR_APPLICATION_FAILURE';
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
      body: JSON.stringify({ model: 'gemini-3.1-flash-lite', request }),
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
      message: String(body.providerMessage || body.error || body.text || raw).replace(/\\s+/g, ' ').slice(0, 180)
    };
    console.log(JSON.stringify(result));
    return result;
  } catch (error) {
    const result = { attempt: index, feature, status: 0, classification: 'EXTERNAL_RUNNER_NETWORK_FAILURE', durationMs: Date.now() - started, message: String(error.message).slice(0, 180) };
    console.log(JSON.stringify(result));
    return result;
  }
}

function writeSummary(summary) {
  const md = [
    '### Production chat + screen-vision stability gate',
    '',
    '- **Gate result:** ' + summary.result,
    '- **Failure classification:** ' + summary.failureDomain,
    '- **Elapsed:** ' + summary.elapsedMs + ' ms (target ' + durationMs + ' ms)',
    '- **Requests:** ' + summary.total,
    '- **Chat:** ' + summary.chatOk + '/' + summary.chatTotal + ' passed',
    '- **Screen vision:** ' + summary.visionOk + '/' + summary.visionTotal + ' passed',
    '- **API revision mismatches:** ' + summary.revisionMismatch,
    '- **Classifications:** ' + JSON.stringify(summary.counts),
    '',
    summary.failureDomain === 'EXTERNAL_DEPENDENCY'
      ? '> The observed failures match provider/hosting/network outage or quota signatures. This is not proof of an application-code regression. The required production gate remains FAILED; do not change app code solely on this evidence.'
      : summary.failureDomain === 'APPLICATION_OR_DEPLOYMENT_REVIEW'
        ? '> At least one API contract/configuration/revision failure was observed. Investigate the exact response and deployed revision before editing application code.'
        : summary.failureDomain === 'MIXED_OR_UNCLASSIFIED'
          ? '> Failures have mixed or ambiguous signatures. Review individual attempt logs before deciding whether code changes are justified.'
          : '> All probes passed and the deployed API revision matched.'
  ].join('\\n') + '\\n';
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  if (summary.result === 'FAIL') {
    const command = summary.failureDomain === 'EXTERNAL_DEPENDENCY' ? 'warning' : 'error';
    console.log('::' + command + '::Production stability gate FAILED; classification=' + summary.failureDomain + '. See job summary and per-attempt JSON logs. This gate remains blocking.');
  }
}

async function main() {
  console.log(JSON.stringify({ event: 'start', endpoint, durationMs, intervalMs, expectedRevision }));
  const started = Date.now();
  const results = [];
  let index = 0;
  results.push(await request('chat', ++index));
  let nextVision = true;
  while (Date.now() - started < durationMs && !results.some(item => item.classification === 'EXTERNAL_QUOTA_OR_RATE_LIMIT')) {
    const feature = nextVision ? 'screen-vision' : 'chat';
    const result = await request(feature, ++index);
    results.push(result);
    if (result.classification === 'EXTERNAL_QUOTA_OR_RATE_LIMIT') {
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
  const revisionMismatch = results.filter(item => item.revision !== expectedRevision);
  const allOk = results.every(item => item.classification === 'OK') && revisionMismatch.length === 0 && Date.now() - started >= durationMs;
  const externalClasses = new Set(['EXTERNAL_QUOTA_OR_RATE_LIMIT', 'EXTERNAL_UPSTREAM_OR_HOSTING_FAILURE', 'EXTERNAL_RUNNER_NETWORK_FAILURE', 'EXTERNAL_OR_UNCLASSIFIED_SERVER_FAILURE']);
  const hasExternal = results.some(item => externalClasses.has(item.classification));
  const hasInternalReview = results.some(item => ['API_CONFIGURATION_OR_ROUTING_FAILURE', 'API_CONTRACT_OR_APPLICATION_FAILURE'].includes(item.classification)) || revisionMismatch.length > 0;
  const failureDomain = allOk ? 'NONE' : hasExternal && hasInternalReview ? 'MIXED_OR_UNCLASSIFIED' : hasExternal ? 'EXTERNAL_DEPENDENCY' : 'APPLICATION_OR_DEPLOYMENT_REVIEW';
  const summary = {
    event: 'summary', elapsedMs: Date.now() - started, total: results.length,
    counts, visionTotal: vision.length, visionOk: vision.filter(x => x.classification === 'OK').length,
    chatTotal: chat.length, chatOk: chat.filter(x => x.classification === 'OK').length,
    revisionMismatch: revisionMismatch.length, failureDomain, result: allOk ? 'PASS' : 'FAIL'
  };
  console.log(JSON.stringify(summary));
  writeSummary(summary);
  // Strict production gate: outages are classified more accurately, not waived.
  if (!allOk) process.exitCode = 1;
}
main().catch(error => { console.error('DIAGNOSTIC_FATAL:', error.stack || error.message); process.exitCode = 1; });
