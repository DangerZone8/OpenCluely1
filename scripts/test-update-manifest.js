"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createManifest } = require("./generate-update-manifest");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "slickly-update-manifest-"));
try {
  const cases = [
    { platform: "win", name: "latest.yml", artifacts: ["Slickly-AI-Setup-1.2.3.exe", "Slickly-AI-1.2.3.exe"] },
    { platform: "mac", name: "latest-mac.yml", artifacts: ["Slickly AI-1.2.3-mac.zip", "Slickly.AI-1.2.3-arm64-mac.zip"] },
    { platform: "linux", name: "latest-linux.yml", artifacts: ["Slickly AI-1.2.3.AppImage"] }
  ];
  for (const item of cases) {
    const dir = path.join(root, item.platform);
    fs.mkdirSync(dir);
    for (const artifact of item.artifacts) fs.writeFileSync(path.join(dir, artifact), Buffer.from("test artifact " + artifact));
    const result = createManifest(item.platform, "1.2.3", dir);
    assert.equal(path.basename(result.output), item.name);
    const yaml = fs.readFileSync(result.output, "utf8");
    assert.match(yaml, /version: "1\.2\.3"/);
    for (const artifact of item.artifacts.filter(name => item.platform !== "win" || name.includes("Setup"))) {
      assert.ok(yaml.includes(artifact), "manifest should include " + artifact);
      const bytes = fs.readFileSync(path.join(dir, artifact));
      assert.ok(yaml.includes(crypto.createHash("sha512").update(bytes).digest("base64")));
    }
    if (item.platform === "win") assert.ok(!yaml.includes("Slickly-AI-1.2.3.exe"), "portable Windows build must not be advertised for auto-update");
  }
  assert.throws(() => createManifest("win", "1.0.0", path.join(root, "missing")), /ENOENT/);
  console.log("Update manifest tests passed: Windows NSIS, macOS Intel/ARM zip artifacts, Linux AppImage, SHA-512, and portable-Windows exclusion.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
