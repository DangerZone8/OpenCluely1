'use strict';

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 10;
// A single live-screen session sends about 9 frames/minute at the 6.5s UI interval.
// Leave room for a manual capture and one transient retry without weakening chat limits.
const MAX_SCREEN_PER_WINDOW = 20;
// Conservative per-IP and per-install budget for the shared free-tier provider key.
// This is a best-effort guard; durable project-wide enforcement needs a shared store.
const MAX_PER_DAY = 120;
// Continuous screen vision is budgeted separately from conversational chat.
// At a six-second frame interval, 180 frames allows about 18 minutes of live use/day.
const MAX_SCREEN_PER_DAY = 180;
const counters = globalThis.__openCluelyGeminiCounters || new Map();
globalThis.__openCluelyGeminiCounters = counters;

function respond(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Fingerprint the deployed handler so production-alias drift is observable in E2E logs.
  res.setHeader('X-OpenCluely-API-Revision', 'v175-fast-chat-2026-10-26-h');
  res.end(JSON.stringify(body));
}

function rateLimit(key, now, maxPerWindow = MAX_PER_WINDOW, maxPerDay = MAX_PER_DAY) {
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
  return entry.windowCount <= maxPerWindow && entry.dayCount <= maxPerDay;
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
      error: 'The Slickly AI service is not configured in this deployment. Verify the Production environment variables and redeploy.',
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
  const feature = req.headers['x-opencluely-feature'] === 'screen-vision' ? 'screen-vision' : 'chat';
  const dailyLimit = feature === 'screen-vision' ? MAX_SCREEN_PER_DAY : MAX_PER_DAY;
  // Isolate screen-frame traffic from chat/audio so a live session cannot
  // consume the conversational budget. Each feature still has bounded limits.
  if (
    !rateLimit('ip:' + ip + ':' + feature, now, feature === 'screen-vision' ? MAX_SCREEN_PER_WINDOW : MAX_PER_WINDOW, dailyLimit) ||
    !rateLimit('install:' + installId + ':' + feature, now, feature === 'screen-vision' ? MAX_SCREEN_PER_WINDOW : MAX_PER_WINDOW, dailyLimit)
  ) {
    res.setHeader('Retry-After', '60');
    return respond(res, 429, { error: 'Slickly AI ' + feature + ' request limit reached. Wait a minute and try again.' });
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
  // Preserve the fast path: successful chat requests make one provider call.
  // If Gemini explicitly reports a transient/model-specific failure, allow one
  // distinct alternate model for both chat and vision. Transport failures and
  // quota exhaustion still stop immediately to avoid wasting time/quota.
  const fallbackCandidates = feature === 'screen-vision'
    ? ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-3.8-flash']
    : ['gemini-3.5-flash', 'gemini-3.1-flash-lite'];
  const fallbackModels = [
    model,
    ...fallbackCandidates.filter(candidate => candidate !== model)
  ].slice(0, 2);
  let lastFailure = null;
  const attemptedModels = [];
  // Bound the whole request while allowing a fast alternate when the provider
  // promptly rejects a model. The first attempt remains the normal fast path.
  // vercel.json explicitly allows 30 seconds for this route. Keep the overall
  // provider budget below that ceiling while allowing one alternate-model retry.
  const requestDeadline = Date.now() + 28000;

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
        signal: AbortSignal.timeout(Math.min(18000, remainingMs))
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
      // A timed-out model may be overloaded while an alternate model is healthy.
      // Keep both attempts below the serverless function ceiling and preserve
      // time to serialize a response before the platform kills the invocation.
      lastFailure = { status: 0, code: 'NETWORK_OR_TIMEOUT', message: 'Provider request timed out or could not be reached.' };
      tryAnotherModel = true;
      if (requestDeadline - Date.now() < 7000) break;
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
