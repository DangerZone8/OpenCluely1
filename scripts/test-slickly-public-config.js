'use strict';

const assert = require('node:assert/strict');
const publicConfig = require('../api/public-config');

function response() {
  return {
    statusCode: 200, headers: {}, body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.body = body || ''; }
  };
}

(async () => {
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'never-return-this-server-secret';
    const missing = response();
    publicConfig({ method: 'GET' }, missing);
    assert.equal(missing.statusCode, 503);
    assert.deepEqual(JSON.parse(missing.body).missing, ['SUPABASE_URL (must be a valid HTTPS Supabase project URL)', 'SUPABASE_ANON_KEY or SUPABASE_PUBLISHABLE_KEY']);

    process.env.SUPABASE_URL = '  "https://example-project.supabase.co/auth/v1"  ';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_public_key_123456789';
    const ready = response();
    publicConfig({ method: 'GET' }, ready);
    assert.equal(ready.statusCode, 200);
    const body = JSON.parse(ready.body);
    assert.equal(body.supabaseUrl, 'https://example-project.supabase.co');
    assert.equal(body.supabaseAnonKey, process.env.SUPABASE_PUBLISHABLE_KEY);
    assert.equal(JSON.stringify(body).includes('never-return-this-server-secret'), false);

    const wrongMethod = response();
    publicConfig({ method: 'POST' }, wrongMethod);
    assert.equal(wrongMethod.statusCode, 405);
    process.env.SUPABASE_URL = 'http://example-project.supabase.co';
    const insecure = response();
    publicConfig({ method: 'GET' }, insecure);
    assert.equal(insecure.statusCode, 503);
    assert.match(JSON.parse(insecure.body).missing[0], /HTTPS/);

    console.log('PASS: public Supabase config normalizes quoted/path URLs, rejects insecure URLs, supports publishable keys, and never exposes the service-role secret.');
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
