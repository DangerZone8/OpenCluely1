"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CloudConfigService, DEFAULT_CONFIG, validateConfig } = require("../src/services/cloud-config.service");
const api = require("../api/cloud-config");

function response() {
  return { statusCode: 200, headers: {}, body: "", setHeader(k,v){this.headers[k.toLowerCase()]=v;}, end(v){this.body=v||"";} };
}

async function run() {
  const valid = validateConfig(DEFAULT_CONFIG, "1.0.345", "stable-install");
  assert.equal(valid.features.premiumAi, false, "paid features must be off by default");
  assert.equal(valid.features.cloudConfig, true);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, schemaVersion: 99 }, "1.0.345"), /schema/);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, revision: "../bad" }, "1.0.345"), /revision/);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, rolloutPercent: 101 }, "1.0.345"), /rollout/);
  assert.throws(() => validateConfig({ ...DEFAULT_CONFIG, minimumAppVersion: "9.0.0" }, "1.0.345"), /no longer supported/);
  const stableA = validateConfig({ ...DEFAULT_CONFIG, rolloutPercent: 50 }, "1.0.345", "same-install");
  const stableB = validateConfig({ ...DEFAULT_CONFIG, rolloutPercent: 50 }, "1.0.345", "same-install");
  assert.equal(stableA.inRollout, stableB.inRollout, "rollout cohort must be deterministic");
  const unsafe = validateConfig({ ...DEFAULT_CONFIG, presentation: { announcement: "hello", announcementUrl: "https://evil.example" } }, "1.0.345");
  assert.equal(unsafe.presentation.announcementUrl, "", "external announcement URLs must be rejected");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slickly-cloud-config-"));
  try {
    const cachePath = path.join(dir, "cache", "cloud.json");
    const service = new CloudConfigService({
      cachePath, appVersion: "1.0.345", installId: "test-install",
      fetch: async () => ({ ok: true, json: async () => ({ ...DEFAULT_CONFIG, revision: "release-2", features: { ...DEFAULT_CONFIG.features, newSettingsExperience: true } }) })
    });
    const next = await service.refresh();
    assert.equal(next.revision, "release-2");
    assert.equal(next.features.newSettingsExperience, true);
    assert.ok(fs.existsSync(cachePath), "validated config should be cached atomically");
    const rollback = new CloudConfigService({
      cachePath, appVersion: "1.0.345", installId: "test-install",
      fetch: async () => ({ ok: true, json: async () => ({ ...DEFAULT_CONFIG, revision: "release-1" }) })
    });
    await assert.rejects(() => rollback.refresh(), /stale cloud configuration/);
    const identityPath = path.join(dir, "identity", "config.json");
    const installA = new CloudConfigService({ cachePath: identityPath, appVersion: "1.0.345" });
    const installB = new CloudConfigService({ cachePath: identityPath, appVersion: "1.0.345" });
    assert.equal(installA.installId, installB.installId, "installation cohort ID must persist across app restarts");
    assert.match(installA.installId, /^[0-9a-f-]{36}$/i);
    const offline = new CloudConfigService({ cachePath, appVersion: "1.0.345", installId: "test-install", fetch: async () => { throw new Error("offline"); } });
    assert.equal(offline.getSnapshot().revision, "release-2", "cached config must survive offline startup");
    await assert.rejects(() => offline.refresh(), /offline/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const oldEnv = process.env.SLICKLY_CLOUD_CONFIG_JSON;
  try {
    delete process.env.SLICKLY_CLOUD_CONFIG_JSON;
    const res = response();
    api({ method: "GET" }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).schemaVersion, 1);
    const bad = response();
    api({ method: "POST" }, bad);
    assert.equal(bad.statusCode, 405);
    process.env.SLICKLY_CLOUD_CONFIG_JSON = JSON.stringify({ ...DEFAULT_CONFIG, revision: "../invalid" });
    const invalid = response();
    api({ method: "GET" }, invalid);
    assert.equal(invalid.statusCode, 503, "invalid remote config must fail closed");
    process.env.SLICKLY_CLOUD_CONFIG_JSON = JSON.stringify({ ...DEFAULT_CONFIG, pollIntervalMs: 59999 });
    const invalidInterval = response();
    api({ method: "GET" }, invalidInterval);
    assert.equal(invalidInterval.statusCode, 503, "server must reject polling intervals below one minute");
    process.env.SLICKLY_CLOUD_CONFIG_JSON = JSON.stringify({ ...DEFAULT_CONFIG, pollIntervalMs: 86400001 });
    const excessiveInterval = response();
    api({ method: "GET" }, excessiveInterval);
    assert.equal(excessiveInterval.statusCode, 503, "server must reject polling intervals above one day");
    process.env.SLICKLY_CLOUD_CONFIG_JSON = JSON.stringify({ ...DEFAULT_CONFIG, pollIntervalMs: 60000 });
    const minimumInterval = response();
    api({ method: "GET" }, minimumInterval);
    assert.equal(minimumInterval.statusCode, 200, "server must accept the minimum valid polling interval");
  } finally {
    if (oldEnv === undefined) delete process.env.SLICKLY_CLOUD_CONFIG_JSON;
    else process.env.SLICKLY_CLOUD_CONFIG_JSON = oldEnv;
  }
  console.log("Slickly cloud-config tests passed: schema validation, safe defaults, deterministic rollout, offline cache, stale minimum version, URL allowlist, and API method/error handling.");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
