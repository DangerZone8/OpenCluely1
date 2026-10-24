'use strict';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 10;
// Conservative per-IP and per-install budget for the shared free-tier provider key.
// This is a best-effort guard; durable project-wide enforcement needs a shared store.
const MAX_PER_DAY = 12;
const counters = globalThis.__openCluelyGeminiCounters || new Map();
globalThis.__openCluelyGeminiCounters = counters;

function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Fingerprint the deployed handler so production-alias drift is observable in E2E logs.
  res.setHeader('X-OpenCluely-API-Revision', 'bounded-fallback-2026-10-24-b');
  res.end(JSON.stringify(body));
}

function rateLimit(key, now) {
  let entry = counters.get(key);
  if (!entry) {
    entry = { windowStart: now, windowCount: 0, dayStart: now, dayCount: 0 };
  }
  if (now - entry.windowStart >= WINDOW_MS) {
    entry.windowStart = now;
    entry.windowCount = 0;
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

  // Accept the common Google/Gemini environment-variable names. Trim whitespace
  // so a copied value with a trailing newline is not treated as a usable key.
  const key = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_GENAI_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  ].map(value => typeof value === 'string' ? value.trim() : '').find(Boolean);
  if (!key) {
    // Safe diagnostics: report only whether supported names exist, never values.
    return respond(res, 503, {
      error: 'The Cleverly AI service is not configured in this deployment. Verify the Production environment variables and redeploy.',
      configuredNames: {
        GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()),
        GOOGLE_API_KEY: Boolean(process.env.GOOGLE_API_KEY && process.env.GOOGLE_API_KEY.trim()),
        GOOGLE_GENAI_API_KEY: Boolean(process.env.GOOGLE_GENAI_API_KEY && process.env.GOOGLE_GENAI_API_KEY.trim()),
        GOOGLE_GENERATIVE_AI_API_KEY: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY && process.env.GOOGLE_GENERATIVE_AI_API_KEY.trim())
      }
    });
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
  const ip = String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  if (!rateLimit('ip:' + ip, now) || !rateLimit('install:' + installId, now)) {
    res.setHeader('Retry-After', '60');
    return respond(res, 429, { error: 'Cleverly AI request limit reached. Wait a minute and try again.' });
  }

  const request = body.request;
  const allowedModels = new Set([
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3.5-flash',
    'gemini-3.6-flash',
    'gemini-3.8-flash'
  ]);
  const model = allowedModels.has(body.model) ? body.model : 'gemini-3.5-flash-lite';
  if (!request || typeof request !== 'object' || !Array.isArray(request.contents) || request.contents.length === 0) {
    return respond(res, 400, { error: 'AI request is missing content.' });
  }

  const isVisionRequest = request.contents.some(item =>
    Array.isArray(item?.parts) && item.parts.some(part => part && (part.inlineData || part.fileData))
  );
  // Keep the configured fast model first for every request. Permit one alternate
  // only after an explicit provider response (e.g. model unavailable); transport
  // failures/timeouts break immediately below instead of serially delaying chat.
  const fallbackModels = [
    model,
    ...['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-3.8-flash'].filter(candidate => candidate !== model)
  ].slice(0, 2);
  let lastFailure = null;
  const attemptedModels = [];
  // Bound the whole request while allowing a fast alternate when the provider
  // promptly rejects a model. The first attempt remains the normal fast path.
  const requestDeadline = Date.now() + 9000;

  for (const candidate of fallbackModels) {
    const remainingMs = requestDeadline - Date.now();
    if (remainingMs <= 0) break;
    let tryAnotherModel = false;
    attemptedModels.push(candidate);
    try {
      const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(candidate) + ':generateContent', {
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
        signal: AbortSignal.timeout(Math.min(8000, remainingMs))
      });
      const result = await upstream.json().catch(() => ({}));
      if (upstream.ok) {
        const text = (result.candidates || [])
          .flatMap(item => item.content && Array.isArray(item.content.parts) ? item.content.parts : [])
          .map(part => typeof part.text === 'string' ? part.text : '')
          .filter(Boolean)
          .join('\n')
          .trim();
        if (text) return respond(res, 200, { text, model: candidate });
        lastFailure = { status: 502, code: 'EMPTY_RESPONSE', message: 'The model returned no text.' };
        tryAnotherModel = true;
        continue;
      }

      const providerCode = typeof result.error?.status === 'string' ? result.error.status : '';
      const transient = [500, 502, 503, 504].includes(upstream.status) ||
        ['UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED'].includes(providerCode);
      lastFailure = {
        status: upstream.status,
        code: providerCode || undefined,
        message: typeof result.error?.message === 'string' ? result.error.message.slice(0, 180) : undefined
      };
      // Never fan out to more models after a quota/rate-limit response.
      if (providerCode === 'RESOURCE_EXHAUSTED' || upstream.status === 429) {
        return respond(res, 429, {
          error: 'Gemini usage limit reached for this API project. Further model retries are disabled to avoid wasting quota. Try again after the provider reset or review the project quota.',
          providerStatus: upstream.status,
          providerCode: providerCode || 'RATE_LIMITED',
          retryAfterSeconds: 3600
        });
      }
      if (providerCode === 'INVALID_ARGUMENT' || providerCode === 'NOT_FOUND' || providerCode === 'MODEL_NOT_FOUND') {
        // A retired or unavailable model name is model-specific, not a reason
        // to fail the entire request when a supported fallback remains.
        lastFailure = { status: upstream.status, code: providerCode, message: lastFailure.message };
        tryAnotherModel = true;
        continue;
      }
      if (!transient) {
        return respond(res, upstream.status === 429 ? 429 : 502, {
          error: 'The AI service could not complete this request.',
          providerStatus: upstream.status,
          providerCode: lastFailure.code,
          providerMessage: lastFailure.message
        });
      }
      tryAnotherModel = true;
    } catch (error) {
      lastFailure = { status: 0, code: 'NETWORK_OR_TIMEOUT', message: 'Provider request timed out or could not be reached.' };
      // A timeout/network failure is shared by all model IDs. Do not spend the
      // remaining deadline retrying the same unreachable provider host.
      break;
    }
    if (!tryAnotherModel) break;
  }

  const providerStatus = lastFailure?.status || 503;
  return respond(res, providerStatus === 429 ? 429 : 502, {
    error: 'The AI service is temporarily unavailable across its configured models. Please try again shortly.',
    providerStatus,
    providerCode: lastFailure?.code,
    providerMessage: lastFailure?.message,
    attemptedModels: [...new Set(attemptedModels)]
  });
};
