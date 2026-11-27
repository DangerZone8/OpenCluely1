'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const api = fs.readFileSync('api/gemini.js', 'utf8');
const client = fs.readFileSync('src/services/llm.service.js', 'utf8');
const migration = fs.readFileSync('supabase/migrations/202611260001_slickly_anonymous_chat_credits.sql', 'utf8');

assert.match(api, /consume_slickly_anonymous_chat_credit/);
assert.match(api, /p_credit_limit:\s*5/);
assert.match(api, /hostedProviderId = 'gemini'/);
assert.match(api, /feature !== 'chat' \|\| hasAudio \|\| isVisionRequest/);
assert.match(api, /ANONYMOUS_CHAT_CREDITS_EXHAUSTED/);
assert.match(api, /createHmac\('sha256'/);
assert.match(api, /x-opencluely-install-id/,'anonymous allowance identity must include the desktop installation ID');
assert.match(api, /requestedFeature === 'voice'/,'authenticated Whisper transcripts must use the voice credit bucket');
assert.match(client, /accessToken \? \{ Authorization: 'Bearer ' \+ accessToken \} : \{\}/);
assert.match(migration, /credits_used <= 5/);
assert.match(migration, /credits_used < 5/);
assert.match(migration, /security definer/i);
assert.match(migration, /grant execute .* to service_role/i);
assert.match(migration, /revoke all .* from public, anon, authenticated/i);
console.log('Slickly anonymous tier checks passed: five lifetime credits, chat-only, server-side atomic enforcement, Gemini-only, and no client token required.');
