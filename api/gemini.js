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
  // Support an ordered key pool so a deployment can fail over when one
  // Google AI project reaches its quota. Keys must belong to independently
  // quota-managed projects; multiple keys from the same project share quota.
  // Configure GEMINI_API_KEYS as a comma/newline-separated list, or use
  // GEMINI_API_KEY plus GEMINI_API_KEY_2 / GEMINI_API_KEY_3.
  const keys = [
    process.env.GEMINI_API_KEYS,
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_GENAI_API_KEY,
    process.env.GOOGLE_GENERATIVE_AI_API_KEY
  ].flatMap(value => typeof value === 'string' ? value.split(/[\n,]+/) : [])
    .map(value => value.trim())
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
  if (!keys.length) {
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
  // Strict single-model policy: every request uses Gemini 3 Flash Preview only.
  const model = 'gemini-3-flash-preview';
  if (!request || typeof request !== 'object' || !Array.isArray(request.contents) || request.contents.length === 0) {
    return respond(res, 400, { error: 'AI request is missing content.' });
  }

  const isVisionRequest = request.contents.some(item =>
    Array.isArray(item?.parts) && item.parts.some(part => part && (part.inlineData || part.fileData))
  );
  // Strict single-model policy: only Gemini 3 Flash Preview is allowed.
  // Retry the same model with the next independently quota-managed key when
  // Google explicitly reports RESOURCE_EXHAUSTED. This must be a key loop,
  // not a model-loop continue: there is deliberately no alternate model.
  const model = 'gemini-3-flash-preview';
  let lastFailure = null;
  const requestDeadline = Date.now() + 8200;
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const remainingMs = requestDeadline - Date.now();
    if (remainingMs <= 0) {
      lastFailure = { status: 0, code: 'NETWORK_OR_TIMEOUT', message: 'Provider request timed out or could not be reached.' };
      break;
    }
    try {
      const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': keys[keyIndex]
        },
        body: JSON.stringify({
          contents: request.contents,
          generationConfig: request.generationConfig || {},
          ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {})
        }),
        signal: AbortSignal.timeout(Math.min(4000, remainingMs))
      });
      const result = await upstream.json().catch(() => ({}));
      if (upstream.ok) {
        const text = (result.candidates || [])
          .flatMap(item => item.content && Array.isArray(item.content.parts) ? item.content.parts : [])
          .map(part => typeof part.text === 'string' ? part.text : '')
          .filter(Boolean)
          .join('\\n')
          .trim();
        if (text) return respond(res, 200, { text, model });
        lastFailure = { status: 502, code: 'EMPTY_RESPONSE', message: 'The model returned no text.' };
        break;
      }

      const providerCode = typeof result.error?.status === 'string' ? result.error.status : '';
      lastFailure = {
        status: upstream.status,
        code: providerCode || undefined,
        message: typeof result.error?.message === 'string' ? result.error.message.slice(0, 180) : undefined
      };
      if (providerCode === 'RESOURCE_EXHAUSTED' && keyIndex + 1 < keys.length) {
        // Try the next configured key, always using the exact same model.
        continue;
      }
      if (providerCode === 'RESOURCE_EXHAUSTED' || upstream.status === 429) {
        return respond(res, 429, {
          error: providerCode === 'RESOURCE_EXHAUSTED'
            ? 'Gemini quota is exhausted for all configured API keys. Configure GEMINI_API_KEYS with keys from independently quota-managed Google AI projects, or wait for quota reset.'
            : 'Gemini rate limit reached. Please wait before retrying.',
          providerStatus: upstream.status,
          providerCode: providerCode || 'RATE_LIMITED',
          retryAfterSeconds: 3600
        });
      }
      return respond(res, 502, {
        error: 'The AI service could not complete this request.',
        providerStatus: upstream.status,
        providerCode: lastFailure.code,
        providerMessage: lastFailure.message
      });
    } catch (error) {
      lastFailure = { status: 0, code: 'NETWORK_OR_TIMEOUT', message: 'Provider request timed out or could not be reached.' };
      // Transport failures are not quota evidence; do not fan out across keys.
      break;
    }
  }

  const providerStatus = lastFailure?.status || 503;
  return respond(res, providerStatus === 429 ? 429 : 502, {
    error: 'The AI service is temporarily unavailable. Please try again shortly.',
    providerStatus,
    providerCode: lastFailure?.code,
    providerMessage: lastFailure?.message,
    attemptedModels: [model]
  });
};
