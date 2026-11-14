'use strict';

const assert = require('node:assert/strict');
const credits = require('../api/credits');

assert.deepEqual(credits.FREE_DAILY_LIMITS, {
  screen_aware: 2,
  voice: 2,
  screenshot: 3,
  chat: 7
});
assert.deepEqual(credits.PRO_DAILY_LIMITS, {
  screen_aware: 60,
  voice: 60,
  screenshot: 100,
  chat: 200
});

function response() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body || ''; }
  };
}

async function run() {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const oldFetch = global.fetch;
  try {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-secret';
    let rpcArgs;
    global.fetch = async (url, options) => {
      if (url.endsWith('/auth/v1/user')) {
        assert.match(options.headers.Authorization, /^Bearer valid-access-token$/);
        return { ok: true, json: async () => ({ id: '123e4567-e89b-42d3-a456-426614174000' }) };
      }
      assert.match(url, /\/rest\/v1\/rpc\/consume_slickly_credit$/);
      rpcArgs = JSON.parse(options.body);
      return { ok: true, text: async () => JSON.stringify({ allowed: true, used: 1, remaining: 1, daily_limit: 2, resets_at: '2026-11-15T00:00:00Z', plan: 'free' }) };
    };
    const res = response();
    await credits({ method: 'POST', headers: { authorization: 'Bearer valid-access-token' }, body: { feature: 'screen_aware' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).remaining, 1);
    assert.equal(rpcArgs.p_feature, 'screen_aware');
    assert.equal(rpcArgs.p_free_limit, 2);

    const invalid = response();
    await credits({ method: 'POST', headers: { authorization: 'Bearer valid-access-token' }, body: { feature: 'admin' } }, invalid);
    assert.equal(invalid.statusCode, 400);

    const unauthenticated = response();
    await credits({ method: 'POST', headers: {}, body: { feature: 'chat' } }, unauthenticated);
    assert.equal(unauthenticated.statusCode, 401);
  } finally {
    global.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
  console.log('Slickly credit API tests passed: exact free/pro limits, verified account requirement, server-side atomic RPC contract and invalid-feature rejection.');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
