'use strict';

const { json } = require('./_lib/slickly-auth');

module.exports = function publicConfig(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { error: 'Use GET.' });
  }
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const anonKey = String(process.env.SUPABASE_ANON_KEY || '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(url) || !anonKey) {
    return json(res, 503, { error: 'Slickly account sign-in is not configured yet.' });
  }
  return json(res, 200, { supabaseUrl: url, supabaseAnonKey: anonKey });
};
