'use strict';

const crypto = require('node:crypto');

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

function getConfig() {
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(supabaseUrl) || !serviceRoleKey) {
    const error = new Error('Slickly account services are not configured.');
    error.statusCode = 503;
    throw error;
  }
  return { supabaseUrl, serviceRoleKey };
}

async function authenticate(req) {
  const { supabaseUrl, serviceRoleKey } = getConfig();
  const authorization = String(req.headers.authorization || '');
  const match = authorization.match(/^Bearer\s+([A-Za-z0-9._~-]+)$/i);
  if (!match) {
    const error = new Error('Sign in to your Slickly account to continue.');
    error.statusCode = 401;
    throw error;
  }
  const response = await fetch(supabaseUrl + '/auth/v1/user', {
    headers: { apikey: serviceRoleKey, Authorization: 'Bearer ' + match[1] }
  });
  if (!response.ok) {
    const error = new Error('Your Slickly session is invalid or expired. Please sign in again.');
    error.statusCode = 401;
    throw error;
  }
  const user = await response.json();
  if (!user || typeof user.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(user.id)) {
    const error = new Error('Slickly could not verify your account.');
    error.statusCode = 401;
    throw error;
  }
  return { user, accessToken: match[1], supabaseUrl, serviceRoleKey };
}

async function rpc(config, name, args) {
  const response = await fetch(config.supabaseUrl + '/rest/v1/rpc/' + encodeURIComponent(name), {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: 'Bearer ' + config.serviceRoleKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args)
  });
  const body = await response.text();
  let data;
  try { data = body ? JSON.parse(body) : null; } catch { data = null; }
  if (!response.ok) {
    const error = new Error(data?.message || 'Slickly account service request failed.');
    error.statusCode = response.status >= 500 ? 503 : 400;
    throw error;
  }
  return data;
}

function safeError(res, error) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 503;
  return json(res, status, { error: error?.message || 'Slickly account service is temporarily unavailable.' });
}

module.exports = { json, getConfig, authenticate, rpc, safeError };
