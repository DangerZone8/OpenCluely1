'use strict';

const { authenticate, rpc, safeError } = require('./_lib/slickly-auth');

const FREE_DAILY_LIMITS = Object.freeze({ screen_aware: 2, voice: 2, screenshot: 3, chat: 7 });
const PRO_DAILY_LIMITS = Object.freeze({ screen_aware: 20, voice: 6, screenshot: 10, chat: 40 });
const PRO_MONTHLY_BUDGET = 1500;

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_PROMPT_TEXT_CHARS = 20000;
const MAX_INLINE_MEDIA_CHARS = 3500000;
const MAX_CONTENT_MESSAGES = 20;
const MAX_OUTPUT_TOKENS = 512;
const MAX_AUDIO_OUTPUT_TOKENS = 2048;
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
  res.setHeader('X-OpenCluely-API-Revision', 'v177-hosted-multiprovider-2026-11-15-a');
  res.end(JSON.stringify(body));
}

async function recordProviderUsage(account, feature, model, usage) {
  if (!account || !usage) return;
  try {
    await rpc({ supabaseUrl: account.supabaseUrl, serviceRoleKey: account.serviceRoleKey },
      'record_slickly_provider_usage', {
        p_user_id: account.user.id,
        p_feature: feature,
        p_provider: 'gemini',
        p_model: String(model || 'unknown').slice(0, 128),
        p_prompt_tokens: Number(usage.promptTokens) || 0,
        p_output_tokens: Number(usage.outputTokens) || 0,
        p_total_tokens: Number(usage.totalTokens) || 0
      });
  } catch (error) {
    // Telemetry must never turn a completed AI response into a failed request.
    console.warn('[Slickly provider usage telemetry]', JSON.stringify({
      provider: 'gemini', feature, message: String(error?.message || error).slice(0, 140)
    }));
  }
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
  // Prefer the explicitly configured primary key first so a rotated
  // GEMINI_API_KEY is not queued behind a stale GEMINI_API_KEYS pool.
  // Source labels are safe diagnostics; never log or return key values.
  const keyEntries = [
    { name: 'GEMINI_API_KEY', value: process.env.GEMINI_API_KEY },
    { name: 'GEMINI_API_KEYS', value: process.env.GEMINI_API_KEYS },
    { name: 'GEMINI_API_KEY_2', value: process.env.GEMINI_API_KEY_2 },
    { name: 'GEMINI_API_KEY_3', value: process.env.GEMINI_API_KEY_3 },
    { name: 'GOOGLE_API_KEY', value: process.env.GOOGLE_API_KEY },
    { name: 'GOOGLE_GENAI_API_KEY', value: process.env.GOOGLE_GENAI_API_KEY },
    { name: 'GOOGLE_GENERATIVE_AI_API_KEY', value: process.env.GOOGLE_GENERATIVE_AI_API_KEY }
  ].flatMap(entry => typeof entry.value === 'string'
    ? entry.value.split(/[\n,]+/).map((value, index) => ({
        source: entry.name === 'GEMINI_API_KEYS' ? entry.name + '[' + (index + 1) + ']' : entry.name,
        value: value.trim()
      }))
    : [])
    .filter(entry => entry.value)
    .filter((entry, index, all) => all.findIndex(candidate => candidate.value === entry.value) === index);
  const keys = keyEntries.map(entry => entry.value);
  const hostedProviderOverride = String(process.env.SLICKLY_HOSTED_AI_PROVIDER || '').trim().toLowerCase();
  let hostedProviderId = 'gemini';
  if (!keys.length && !hostedProviderOverride &&
      !process.env.SLICKLY_QWENCLOUD_API_KEY && !process.env.QWENCLOUD_API_KEY &&
      !process.env.SLICKLY_DEEPSEEK_API_KEY && !process.env.DEEPSEEK_API_KEY &&
      !process.env.SLICKLY_MOONSHOT_API_KEY && !process.env.MOONSHOT_API_KEY) {
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
  // Strict single-model policy: use Gemini 3.1 Flash Lite for higher request quotas and lower rate-limit risk.
  const model = 'gemini-3.1-flash-lite';
  if (!request || typeof request !== 'object' || !Array.isArray(request.contents) || request.contents.length === 0) {
    return respond(res, 400, { error: 'AI request is missing content.' });
  }
  if (request.contents.length > MAX_CONTENT_MESSAGES) {
    return respond(res, 413, { error: 'This request contains too much conversation history. Start a new chat or shorten the context.' });
  }
  const requestParts = request.contents.flatMap(item => Array.isArray(item?.parts) ? item.parts : []);
  const hasAudioRequest = requestParts.some(part => String(part?.inlineData?.mimeType || part?.inline_data?.mime_type || '').toLowerCase().startsWith('audio/'));
  const promptTextChars = request.contents.reduce((total, item) =>
    total + (Array.isArray(item?.parts) ? item.parts.reduce((sum, part) => sum + (typeof part?.text === 'string' ? part.text.length : 0), 0) : 0), 0) +
    (typeof request.systemInstruction === 'string' ? request.systemInstruction.length : 0);
  if (promptTextChars > MAX_PROMPT_TEXT_CHARS) {
    return respond(res, 413, { error: 'The request context is too long. Shorten the conversation or send a more focused question.' });
  }
  const inlineMediaChars = request.contents.reduce((total, item) =>
    total + (Array.isArray(item?.parts) ? item.parts.reduce((sum, part) =>
      sum + (typeof part?.inlineData?.data === 'string' ? part.inlineData.data.length : 0), 0) : 0), 0);
  if (inlineMediaChars > MAX_INLINE_MEDIA_CHARS) {
    return respond(res, 413, { error: 'The attached image or audio is too large. Capture a smaller frame or shorter clip.' });
  }
  const requestedOutputTokens = Number(request.generationConfig?.maxOutputTokens);
  const outputTokenLimit = hasAudioRequest ? MAX_AUDIO_OUTPUT_TOKENS : MAX_OUTPUT_TOKENS;
  request.generationConfig = {
    ...(request.generationConfig && typeof request.generationConfig === 'object' ? request.generationConfig : {}),
    maxOutputTokens: Number.isFinite(requestedOutputTokens) && requestedOutputTokens > 0
      ? Math.min(Math.floor(requestedOutputTokens), outputTokenLimit)
      : outputTokenLimit
  };

  const isVisionRequest = request.contents.some(item =>
    Array.isArray(item?.parts) && item.parts.some(part => part && (part.inlineData || part.fileData))
  );

  // The hosted endpoint is the final enforcement boundary. Never trust a
  // desktop-only credit check: authenticate the Supabase access token and
  // reserve weighted usage atomically before contacting any AI provider.
  let authenticatedAccount = null;
  let reservedFeature = 'chat';
  try {
    const account = await authenticate(req);
    authenticatedAccount = account;
    const { user, supabaseUrl, serviceRoleKey } = account;
    const hasAudio = hasAudioRequest;
    const requestedFeature = String(body.feature || '');
    const feature = hasAudio
      ? 'voice'
      : isVisionRequest
        ? (requestedFeature === 'screen_aware' ? 'screen_aware' : 'screenshot')
        : 'chat';
    reservedFeature = feature;
    // Every image request is charged at the screenshot weight even when the
    // live-screen quota bucket is selected. This prevents a client from
    // understating multimodal cost by changing its feature label.
    const featureUnits = hasAudio ? 4 : isVisionRequest ? 3 : 1;
    const dailyLimit = Object.prototype.hasOwnProperty.call(PRO_DAILY_LIMITS, feature)
      ? PRO_DAILY_LIMITS[feature] : PRO_DAILY_LIMITS.chat;
    const result = await rpc({ supabaseUrl, serviceRoleKey }, 'consume_slickly_credit_v2', {
      p_user_id: user.id,
      p_feature: feature,
      p_free_daily_limit: FREE_DAILY_LIMITS[feature],
      p_pro_daily_limit: dailyLimit,
      p_feature_units: featureUnits,
      p_pro_monthly_budget: PRO_MONTHLY_BUDGET
    });
    const row = Array.isArray(result) ? result[0] : result;
    if (!row || typeof row.allowed !== 'boolean') {
      return respond(res, 503, { error: 'Slickly could not verify your AI allowance. No provider request was made.' });
    }
    // Keep Free on economical Gemini. Pro may use a separately configured premium model.
    // Missing premium credentials safely fall back to Gemini instead of breaking requests.
    const premiumProvider = String(process.env.SLICKLY_PRO_HOSTED_AI_PROVIDER || 'deepseek').trim().toLowerCase();
    const premiumKeyAvailable = premiumProvider === 'qwencloud'
      ? Boolean(process.env.SLICKLY_QWENCLOUD_API_KEY || process.env.QWENCLOUD_API_KEY)
      : premiumProvider === 'deepseek'
        ? Boolean(process.env.SLICKLY_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY)
        : premiumProvider === 'kimi'
          ? Boolean(process.env.SLICKLY_MOONSHOT_API_KEY || process.env.MOONSHOT_API_KEY)
          : false;
    hostedProviderId = hostedProviderOverride || (row.plan === 'pro' && premiumKeyAvailable ? premiumProvider : 'gemini');
    if (!row.allowed) {
      const monthlyExhausted = row.limit_reason === 'monthly_budget';
      return respond(res, 429, {
        error: monthlyExhausted
          ? 'Your 1,500 monthly Pro credits are used up. They reset at the start of next month.'
          : 'You have used today’s ' + feature.replace('_', ' ') + ' credits.',
        code: monthlyExhausted ? 'MONTHLY_BUDGET_EXHAUSTED' : 'DAILY_CREDITS_EXHAUSTED',
        feature,
        remaining: Number(row.remaining) || 0,
        limit: Number(row.daily_limit) || dailyLimit,
        resetsAt: row.resets_at || null,
        plan: row.plan || 'free',
        monthly: row.plan === 'pro' ? {
          used: Number(row.monthly_used) || 0,
          limit: Number(row.monthly_limit) || PRO_MONTHLY_BUDGET,
          remaining: Number(row.monthly_remaining) || 0
        } : null
      });
    }
  } catch (error) {
    return safeError(res, error);
  }

  // Optional hosted-provider routing. The default remains Gemini until an
  // authorised operator configures a provider and its server-only API key.
  // Provider keys are never accepted from the request body or returned to clients.
  if (hostedProviderId !== 'gemini') {
    try {
      const providerEnv = {
        AI_PROVIDER: hostedProviderId,
        QWENCLOUD_API_KEY: process.env.SLICKLY_QWENCLOUD_API_KEY || process.env.QWENCLOUD_API_KEY || '',
        QWENCLOUD_MODEL: process.env.SLICKLY_QWENCLOUD_MODEL || process.env.QWENCLOUD_MODEL || 'qwen3.8-max',
        QWENCLOUD_BASE_URL: process.env.SLICKLY_QWENCLOUD_BASE_URL || process.env.QWENCLOUD_BASE_URL || '',
        DEEPSEEK_API_KEY: process.env.SLICKLY_DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY || '',
        DEEPSEEK_MODEL: process.env.SLICKLY_DEEPSEEK_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-flash',
        MOONSHOT_API_KEY: process.env.SLICKLY_MOONSHOT_API_KEY || process.env.MOONSHOT_API_KEY || '',
        MOONSHOT_MODEL: process.env.SLICKLY_MOONSHOT_MODEL || process.env.MOONSHOT_MODEL || 'kimi-k3',
        MOONSHOT_BASE_URL: process.env.SLICKLY_MOONSHOT_BASE_URL || process.env.MOONSHOT_BASE_URL || ''
      };
      const { getProvider, executeProviderRequest } = require('../src/services/provider-adapter');
      const provider = getProvider(providerEnv);
      const hasAudio = request.contents.some(item => Array.isArray(item?.parts) &&
        item.parts.some(part => part?.inlineData?.data && /^audio\//i.test(part.inlineData.mimeType || '')));
      if (hasAudio && !['openai'].includes(provider.id)) {
        return respond(res, 422, { error: 'This hosted model does not accept raw audio. Use Slickly speech recognition to transcribe audio first.' });
      }
      const text = await executeProviderRequest(request, providerEnv);
      if (!text) return respond(res, 502, { error: 'The hosted AI provider returned no response.' });
      if (req.headers['x-opencluely-stream'] === '1' && !isVisionRequest) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-OpenCluely-API-Revision', 'v177-hosted-multiprovider-2026-11-15-a');
        res.write('data: ' + JSON.stringify({ text }) + '\n\n');
        res.write('data: [DONE]\\n\\n');
        return res.end();
      }
      return respond(res, 200, { text, model: provider.model, provider: provider.id });
    } catch (error) {
      const message = String(error?.message || error);
      console.error('[Slickly hosted provider error]', JSON.stringify({
        provider: hostedProviderId,
        message: message.slice(0, 180)
      }));
      const missingKey = /API key/i.test(message) && /Add a/i.test(message);
      return respond(res, missingKey ? 503 : 502, {
        error: missingKey
          ? 'The selected hosted AI provider is not configured. Add its server-only API key and redeploy.'
          : 'The selected hosted AI provider could not complete this request.',
        provider: hostedProviderId
      });
    }
  }


  // Typed chat requests opt into SSE so the desktop can render the first
  // generated tokens immediately instead of waiting for the entire answer.
  // Screen vision keeps its existing JSON response contract.
  if (req.headers['x-opencluely-stream'] === '1' && !isVisionRequest) {
    const streamDeadline = Date.now() + 14500;
    let streamFailure = null;
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const keySource = keyEntries[keyIndex].source;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const remainingMs = streamDeadline - Date.now();
        if (remainingMs <= 0) break;
        try {
          const upstream = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/' +
              encodeURIComponent(model) + ':streamGenerateContent?alt=sse',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[keyIndex] },
              body: JSON.stringify({
                contents: request.contents,
                generationConfig: request.generationConfig || {},
                ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {})
              }),
              signal: AbortSignal.timeout(Math.min(10000, remainingMs))
            }
          );
          if (!upstream.ok) {
            const providerResult = await upstream.json().catch(() => ({}));
            const providerCode = typeof providerResult.error?.status === 'string'
              ? providerResult.error.status : '';
            const providerMessage = typeof providerResult.error?.message === 'string'
              ? providerResult.error.message.slice(0, 180) : '';
            streamFailure = { status: upstream.status, code: providerCode, message: providerMessage };
            if ((providerCode === 'RESOURCE_EXHAUSTED' || providerCode === 'API_KEY_INVALID') &&
                keyIndex + 1 < keys.length) break;
            const transient = [500, 502, 503, 504].includes(upstream.status) ||
              ['UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED'].includes(providerCode);
            if (transient && attempt < 2 && Date.now() + 250 < streamDeadline) {
              await new Promise(resolve => setTimeout(resolve, 250));
              continue;
            }
            if (upstream.status === 429 || providerCode === 'RESOURCE_EXHAUSTED') {
              res.setHeader('Retry-After', '60');
              return respond(res, 429, {
                error: 'Gemini rate limit reached. Please wait before retrying.',
                providerStatus: upstream.status,
                providerCode: providerCode || 'RATE_LIMITED'
              });
            }
            if (providerCode === 'API_KEY_INVALID') {
              return respond(res, 503, {
                error: 'The Gemini API key configured for this deployment was rejected by Google.',
                providerStatus: upstream.status,
                providerCode
              });
            }
            if (!transient || attempt === 2) {
              return respond(res, 502, {
                error: 'The AI service could not complete this request.',
                providerStatus: upstream.status,
                providerCode: providerCode || undefined,
                providerMessage
              });
            }
            continue;
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache, no-transform');
          res.setHeader('X-Accel-Buffering', 'no');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('X-OpenCluely-API-Revision', 'v176-streaming-chat-2026-11-06-a');
          const decoder = new TextDecoder();
          let buffer = '';
          let streamedCharacters = 0;
          let streamUsage = null;
          const emitLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) return;
            const payload = trimmed.slice(5).trim();
            if (!payload || payload === '[DONE]') return;
            let packet;
            try { packet = JSON.parse(payload); } catch { return; }
            if (packet.usageMetadata && typeof packet.usageMetadata === 'object') {
              streamUsage = {
                promptTokens: Number(packet.usageMetadata.promptTokenCount) || 0,
                outputTokens: Number(packet.usageMetadata.candidatesTokenCount) || 0,
                totalTokens: Number(packet.usageMetadata.totalTokenCount) || 0
              };
            }
            const piece = (packet.candidates || [])
              .flatMap(candidate => candidate.content && Array.isArray(candidate.content.parts)
                ? candidate.content.parts : [])
              .map(part => typeof part.text === 'string' ? part.text : '')
              .filter(Boolean)
              .join('');
            if (!piece || res.destroyed) return;
            streamedCharacters += piece.length;
            res.write('data: ' + JSON.stringify({ text: piece }) + '\n\n');
          };
          try {
            for await (const chunk of upstream.body) {
              buffer += decoder.decode(chunk, { stream: true });
              let newline;
              while ((newline = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                emitLine(line);
              }
              if (res.destroyed) return;
            }
            buffer += decoder.decode();
            if (buffer.trim()) emitLine(buffer);
            if (streamUsage) await recordProviderUsage(authenticatedAccount, reservedFeature, model, streamUsage);
            if (!res.destroyed) {
              res.write('data: [DONE]\n\n');
              res.end();
            }
            console.info('[Slickly Gemini stream completed]', JSON.stringify({
              model, keySource, streamedCharacters
            }));
            return;
          } catch (error) {
            console.error('[Slickly Gemini stream interrupted]', JSON.stringify({
              model, keySource, message: String(error.message || error).slice(0, 160)
            }));
            if (!res.destroyed && !res.writableEnded) {
              res.write('data: ' + JSON.stringify({ error: 'The AI response stream was interrupted.' }) + '\n\n');
              res.end();
            }
            return;
          }
        } catch (error) {
          streamFailure = { status: 0, code: 'NETWORK_OR_TIMEOUT', message: String(error.message || error).slice(0, 160) };
          if (attempt < 2 && Date.now() + 250 < streamDeadline) {
            await new Promise(resolve => setTimeout(resolve, 250));
            continue;
          }
        }
      }
    }
    return respond(res, 502, {
      error: 'The AI service is temporarily unavailable. Please try again shortly.',
      providerStatus: streamFailure?.status || 503,
      providerCode: streamFailure?.code || 'NETWORK_OR_TIMEOUT'
    });
  }

  // Strict single-model policy: only Gemini 3.1 Flash Lite is allowed.
  // Retry the same model with the next independently quota-managed key when
  // Google explicitly reports RESOURCE_EXHAUSTED. This must be a key loop,
  // not a model-loop continue: there is deliberately no alternate model.
  let lastFailure = null;
  const attemptedKeySources = [];
  // Vercel allows this function 30 seconds. Give image analysis a larger
  // per-attempt window because Gemini vision often needs longer than chat,
  // while preserving the short v175 chat deadline and its fast response path.
  const requestDeadline = Date.now() + (isVisionRequest ? 28000 : 14500);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const keySource = keyEntries[keyIndex].source;
    // Retry transient overloads on the same key/model with bounded backoff.
    // Both chat and vision get up to three attempts; the shared deadline caps
    // vision below Vercel's 30-second function limit even when attempts time out.
    const maxProviderAttempts = 3;
    for (let providerAttempt = 1; providerAttempt <= maxProviderAttempts; providerAttempt += 1) {
      const remainingMs = requestDeadline - Date.now();
      if (remainingMs <= 0) {
        lastFailure = { status: 0, code: 'NETWORK_OR_TIMEOUT', message: 'Provider request timed out or could not be reached.' };
        break;
      }
      if (!attemptedKeySources.includes(keySource)) attemptedKeySources.push(keySource);
      console.info('[Slickly Gemini provider attempt]', JSON.stringify({ model, keySource, keyIndex: keyIndex + 1, providerAttempt, configuredKeyCount: keys.length }));
      try {
        const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys[keyIndex] },
          body: JSON.stringify({
            contents: request.contents,
            generationConfig: request.generationConfig || {},
            ...(request.systemInstruction ? { systemInstruction: request.systemInstruction } : {})
          }),
          signal: AbortSignal.timeout(Math.min(isVisionRequest ? 12000 : 3800, remainingMs))
        });
        const result = await upstream.json().catch(() => ({}));
        if (upstream.ok) {
          const text = (result.candidates || [])
            .flatMap(item => item.content && Array.isArray(item.content.parts) ? item.content.parts : [])
            .map(part => typeof part.text === 'string' ? part.text : '')
            .filter(Boolean)
            .join('\\n')
            .trim();
          if (text) {
            const usage = result.usageMetadata && typeof result.usageMetadata === 'object' ? {
              promptTokens: Number(result.usageMetadata.promptTokenCount) || 0,
              outputTokens: Number(result.usageMetadata.candidatesTokenCount) || 0,
              totalTokens: Number(result.usageMetadata.totalTokenCount) || 0
            } : null;
            if (usage) {
              console.info('[Slickly Gemini usage]', JSON.stringify({ model, ...usage }));
              await recordProviderUsage(authenticatedAccount, reservedFeature, model, usage);
            }
            return respond(res, 200, { text, model, ...(usage ? { usage } : {}) });
          }
          lastFailure = { status: 502, code: 'EMPTY_RESPONSE', message: 'The model returned no text.' };
          break;
        }
        const providerCode = typeof result.error?.status === 'string' ? result.error.status : '';
        console.warn('[Slickly Gemini provider response]', JSON.stringify({ model, keySource, providerAttempt, status: upstream.status, providerCode: providerCode || null }));
        lastFailure = {
          status: upstream.status,
          code: providerCode || undefined,
          message: typeof result.error?.message === 'string' ? result.error.message.slice(0, 180) : undefined
        };
        const invalidApiKey = providerCode === 'API_KEY_INVALID' ||
          /api key not valid|invalid api key/i.test(lastFailure.message || '');
        // A stale primary key must not block a valid secondary key configured
        // for the same deployment. Never log or expose any key material.
        if (invalidApiKey && keyIndex + 1 < keys.length) break;
        if (providerCode === 'RESOURCE_EXHAUSTED' && keyIndex + 1 < keys.length) break;
        if (invalidApiKey) {
          return respond(res, 503, {
            error: 'The Gemini API key configured for this deployment was rejected by Google. Update GEMINI_API_KEY in the Vercel Production environment and redeploy.',
            providerStatus: upstream.status,
            providerCode: 'API_KEY_INVALID',
            attemptedKeySources,
            configuredKeyCount: keys.length,
            attemptedModels: [model]
          });
        }
        const transient = [500, 502, 503, 504].includes(upstream.status) ||
          ['UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED'].includes(providerCode);
        if (transient && providerAttempt < maxProviderAttempts && Date.now() + 200 < requestDeadline) {
          // Back off instead of immediately repeating requests to an overloaded provider.
          const backoffMs = Math.min(1500, 500 * (2 ** (providerAttempt - 1))) + Math.floor(Math.random() * 150);
          if (Date.now() + backoffMs < requestDeadline) {
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }
        }
        // After this key's transient retries, try another configured key if available.
        if (transient && keyIndex + 1 < keys.length) break;
        if (providerCode === 'RESOURCE_EXHAUSTED' || upstream.status === 429) {
          return respond(res, 429, {
            error: providerCode === 'RESOURCE_EXHAUSTED'
              ? 'Gemini quota is exhausted for all configured API keys. Configure GEMINI_API_KEYS with keys from independently quota-managed Google AI projects, or wait for quota reset.'
              : 'Gemini rate limit reached. Please wait before retrying.',
            providerStatus: upstream.status,
            providerCode: providerCode || 'RATE_LIMITED',
            attemptedKeySources,
            configuredKeyCount: keys.length,
            retryAfterSeconds: 3600
          });
        }
        return respond(res, 502, {
          error: 'The AI service could not complete this request.',
          providerStatus: upstream.status,
          providerCode: lastFailure.code,
          providerMessage: lastFailure.message,
          attemptedModels: [model]
        });
      } catch (error) {
        lastFailure = { status: 0, code: 'NETWORK_OR_TIMEOUT', message: 'Provider request timed out or could not be reached.' };
        if (providerAttempt < maxProviderAttempts && Date.now() + 200 < requestDeadline) {
          const backoffMs = Math.min(1500, 500 * (2 ** (providerAttempt - 1))) + Math.floor(Math.random() * 150);
          if (Date.now() + backoffMs < requestDeadline) {
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }
        }
        break;
      }
    }
    if ((lastFailure?.code === 'RESOURCE_EXHAUSTED' || lastFailure?.code === 'API_KEY_INVALID') && keyIndex + 1 < keys.length) continue;
    if ((lastFailure?.code === 'NETWORK_OR_TIMEOUT' || lastFailure?.status === 0) && keyIndex + 1 >= keys.length) break;
  }

  const providerStatus = lastFailure?.status || 503;
  return respond(res, providerStatus === 429 ? 429 : 502, {
    error: 'The AI service is temporarily unavailable. Please try again shortly.',
    providerStatus,
    providerCode: lastFailure?.code,
    providerMessage: lastFailure?.message,
    attemptedKeySources,
    configuredKeyCount: keys.length,
    attemptedModels: [model]
  });
};
