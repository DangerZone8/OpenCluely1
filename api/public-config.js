'use strict';

const { json } = require('./_lib/slickly-auth');

module.exports = function publicConfig(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Use GET.' });
  }
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '');
  const missing = [];
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url)) missing.push('SUPABASE_URL');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY');
  if (missing.length) {
    return json(res, 503, { error: 'Slickly sign-in setup is incomplete. Configure these Vercel environment variables and redeploy: ' + missing.join(', '), missing });
  }
  return json(res, 200, { supabaseUrl: url, supabaseAnonKey: anonKey });
};
