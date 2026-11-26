'use strict';

const { json } = require('./_lib/slickly-auth');

module.exports = function publicConfig(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Use GET.' });
  }

  // Vercel values are occasionally pasted with quotes or an API path.
  // Supabase clients need the project origin, so normalize harmless formatting
  // rather than rejecting an otherwise valid project URL.
  const rawUrl = String(process.env.SUPABASE_URL || '').trim().replace(/^["']|["']$/g, '');
  let supabaseUrl = '';
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'https:' && parsed.hostname &&
        !parsed.username && !parsed.password && !parsed.search && !parsed.hash) {
      supabaseUrl = parsed.origin;
    }
  } catch (_) {
    // Report the missing configuration below without echoing environment values.
  }

  const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL (must be a valid HTTPS Supabase project URL)');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY');
  if (missing.length) {
    return json(res, 503, {
      error: 'Slickly sign-in setup is incomplete. Configure these Vercel environment variables and redeploy: ' + missing.join(', '),
      missing
    });
  }
  return json(res, 200, { supabaseUrl, supabaseAnonKey: anonKey });
};
