'use strict';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 25;
const MAX_PER_DAY = 1000;
const counters = globalThis.__openCluelyGeminiCounters || new Map();
globalThis.__openCluelyGeminiCounters = counters;

function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function rateLimit(key, now) {
  let entry = counters.get(key);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { windowStart: now, windowCount: 0, dayStart: now, dayCount: 0 };
  }
  if (now - entry.dayStart >= 24 * 60 * 60 * 1000) {
    entry.dayStart = now;
    entry.dayCount = 0;
  }
  entry.windowCount += 1;
  entry.dayCount += 1;
  counters.set(key, entry);
  return entry.windowCount <= MAX_PER_WINDOW && entry.dayCount <= MAX_PER_DAY;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return respond(res, 405, { error: 'Use POST for AI requests.' });
  }

  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) {
    return respond(res, 503, { error: 'The OpenCluely AI service is not configured yet.' });
  }

  const declaredLength = Number(req.headers['content-length'] || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return respond(res, 413, { error: 'Request is too large. Capture a smaller screen frame or shorter audio segment.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return respond(res, 400, { error: 'Invalid JSON request.' }); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return respond(res, 400, { error: 'Invalid AI request.' });
  }
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_BODY_BYTES) {
    return respond(res, 413, { error: 'Request is too large. Capture a smaller screen frame or shorter audio segment.' });
  }

  const installId = String(req.headers['x-opencluely-install-id'] || '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installId)) {
    return respond(res, 400, { error: 'Missing or invalid installation identifier.' });
  }
  const now = Date.now();
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || String(req.headers['x-real-ip'] || 'unknown');
  if (!rateLimit('ip:' + ip, now) || !rateLimit('install:' + installId, now)) {
    res.setHeader('Retry-After', '60');
    return respond(res, 429, { error: 'OpenCluely AI request limit reached. Wait a minute and try again.' });
  }

  const request = body.request;
  const allowedModels = new Set([
    'gemini-3.1-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-3.5-flash'
  ]);
  const model = allowedModels.has(body.model) ? body.model : 'gemini-3.1-flash-lite';
  if (!request || typeof request !== 'object' || !Array.isArray(request.contents) || request.contents.length === 0) {
    return respond(res, 400, { error: 'AI request is missing content.' });
  }

  try {
    const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key
      },
      body: JSON.stringify({
        contents: request.contents,
        generationConfig: request.generationConfig || {},
        ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {})
      }),
      signal: AbortSignal.timeout(30000)
    });
    const result = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const status = upstream.status === 429 ? 429 : upstream.status === 400 ? 400 : 502;
      return respond(res, status, {
        error: upstream.status === 429
          ? 'The shared AI service is busy or has reached its provider quota. Try again shortly.'
          : 'The AI service could not complete this request. Please try again.'
      });
    }
    const text = (result.candidates || [])
      .flatMap(candidate => candidate.content && Array.isArray(candidate.content.parts) ? candidate.content.parts : [])
      .map(part => typeof part.text === 'string' ? part.text : '')
      .filter(Boolean)
      .join('\n')
      .trim();
    if (!text) return respond(res, 502, { error: 'The AI service returned no text. Please try again.' });
    return respond(res, 200, { text, model });
  } catch (error) {
    return respond(res, 502, { error: 'The shared AI service could not be reached. Please try again.' });
  }
};
