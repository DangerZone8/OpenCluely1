"use strict";
const assert = require("node:assert/strict");
const handler = require("../api/updates/[...path].js");
function response() {
  return { statusCode: 200, headers: {}, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(body) { this.body = body; } };
}
async function run() {
  const originalFetch = global.fetch;
  const assets = [
    { name: "latest.yml", browser_download_url: "https://github.com/DangerZone8/OpenCluely1/releases/download/v9.9.9/latest.yml" },
    { name: "Slickly-AI-Setup-9.9.9.exe", browser_download_url: "https://github.com/DangerZone8/OpenCluely1/releases/download/v9.9.9/Slickly-AI-Setup-9.9.9.exe" },
    { name: "Slickly-AI-Setup-9.9.9.exe.blockmap", browser_download_url: "https://github.com/DangerZone8/OpenCluely1/releases/download/v9.9.9/Slickly-AI-Setup-9.9.9.exe.blockmap" }
  ];
  try {
    global.fetch = async url => {
      if (String(url).includes("/releases/latest")) return { ok: true, status: 200, json: async () => ({ assets }) };
      assert.equal(String(url), assets[0].browser_download_url);
      return { ok: true, text: async () => "version: 9.9.9\\npath: Slickly-AI-Setup-9.9.9.exe\\n" };
    };
    const manifest = response();
    await handler({ method: "GET", query: { path: ["latest.yml"] } }, manifest);
    assert.equal(manifest.statusCode, 200);
    assert.match(manifest.body, /version: 9\\.9\\.9/);
    assert.match(manifest.headers["content-type"], /yaml/);

    const installer = response();
    await handler({ method: "GET", query: { path: ["Slickly-AI-Setup-9.9.9.exe"] } }, installer);
    assert.equal(installer.statusCode, 302);
    assert.equal(installer.headers.location, assets[1].browser_download_url);

    const blockmap = response();
    await handler({ method: "GET", query: { path: ["Slickly-AI-Setup-9.9.9.exe.blockmap"] } }, blockmap);
    assert.equal(blockmap.statusCode, 302);
    assert.equal(blockmap.headers.location, assets[2].browser_download_url);

    const traversal = response();
    await handler({ method: "GET", query: { path: ["..", "secrets"] } }, traversal);
    assert.equal(traversal.statusCode, 400);

    const missing = response();
    await handler({ method: "GET", query: { path: ["unknown.exe"] } }, missing);
    assert.equal(missing.statusCode, 404);

    const wrongMethod = response();
    await handler({ method: "POST", query: { path: ["latest.yml"] } }, wrongMethod);
    assert.equal(wrongMethod.statusCode, 405);
    console.log("Vercel update-feed tests passed: manifest proxy, installer/blockmap redirects, path validation, missing assets, and method guard.");
  } finally { global.fetch = originalFetch; }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
