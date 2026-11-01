'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createManifest } = require('./generate-update-manifest');
const { verifyReleasePayload } = require('./verify-release-payload');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slickly-release-payload-'));
try {
  const artifacts = [
    'Slickly-AI-Setup-1.2.3.exe',
    'slickly-ai_1.2.3_amd64.deb',
    'Slickly AI-1.2.3.AppImage',
    'Slickly AI-1.2.3.dmg',
    'Slickly AI-1.2.3-arm64-mac.zip',
    'Slickly-AI-Setup-1.2.3.exe.blockmap'
  ];
  for (const name of artifacts) fs.writeFileSync(path.join(root, name), Buffer.from('verified fixture: ' + name));
  createManifest('win', '1.2.3', root);
  createManifest('linux', '1.2.3', root);
  createManifest('mac', '1.2.3', root);
  const result = verifyReleasePayload(root);
  assert.deepEqual(Object.keys(result).sort(), ['latest-linux.yml', 'latest-mac.yml', 'latest.yml']);
  assert.throws(() => verifyReleasePayload(path.join(root, 'missing')), /directory does not exist/);

  const windowsManifest = path.join(root, 'latest.yml');
  const original = fs.readFileSync(windowsManifest, 'utf8');
  fs.writeFileSync(windowsManifest, original
    .replaceAll('Slickly-AI-Setup-1.2.3.exe', 'Slickly-AI-Setup-missing.exe'));
  assert.throws(() => verifyReleasePayload(root), /references missing artifact/);
  fs.writeFileSync(windowsManifest, original);
  fs.writeFileSync(path.join(root, 'Slickly-AI-Setup-1.2.3.exe'), Buffer.from('different content'));
  assert.throws(() => verifyReleasePayload(root), /size mismatch|SHA-512 mismatch/);
  console.log('PASS: release payload gate detects missing platform artifacts, missing manifest targets, and size/hash mismatches.');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
