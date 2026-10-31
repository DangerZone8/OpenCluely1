'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function fail(message) { throw new Error('Release payload verification failed: ' + message); }

function verifyManifest(directory, manifestName, expectedPattern) {
  const manifestPath = path.join(directory, manifestName);
  if (!fs.existsSync(manifestPath)) fail('missing ' + manifestName);
  const content = fs.readFileSync(manifestPath, 'utf8');
  const entries = [...content.matchAll(/- url: "([^"]+)"\s*\n\s+sha512: "([^"]+)"\s*\n\s+size: (\d+)/g)];
  if (!entries.length) fail(manifestName + ' has no artifact entries');
  for (const [, name, expectedHash, expectedSize] of entries) {
    if (!expectedPattern.test(name)) fail(manifestName + ' references unexpected artifact ' + name);
    const artifact = path.join(directory, name);
    if (!fs.existsSync(artifact)) fail(manifestName + ' references missing artifact ' + name);
    const data = fs.readFileSync(artifact);
    if (!data.length || data.length !== Number(expectedSize)) fail('size mismatch for ' + name);
    const actualHash = crypto.createHash('sha512').update(data).digest('base64');
    if (actualHash !== expectedHash) fail('SHA-512 mismatch for ' + name);
  }
  const primary = content.match(/^path: "([^"]+)"/m);
  if (!primary || !entries.some(entry => entry[1] === primary[1])) fail(manifestName + ' primary path is not listed in files');
  return entries.map(entry => entry[1]);
}

function verifyReleasePayload(directory) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) fail('release directory does not exist');
  const names = fs.readdirSync(directory);
  const requireMatch = (label, pattern) => {
    const match = names.find(name => pattern.test(name) && fs.statSync(path.join(directory, name)).isFile() && fs.statSync(path.join(directory, name)).size > 0);
    if (!match) fail('missing non-empty ' + label);
    return match;
  };
  requireMatch('Windows NSIS installer', /^Slickly-AI-Setup-.*\.exe$/i);
  requireMatch('Linux Debian package', /^slickly-ai_.*_amd64\.deb$/i);
  requireMatch('Linux AppImage', /\.AppImage$/i);
  requireMatch('macOS DMG', /\.dmg$/i);
  requireMatch('macOS ZIP app bundle', /\.zip$/i);
  requireMatch('electron-updater blockmap', /\.blockmap$/i);

  const manifests = {
    'latest.yml': /^Slickly-AI-Setup-.*\.exe$/i,
    'latest-linux.yml': /^Slickly[ .]AI-.*\.AppImage$/i,
    'latest-mac.yml': /^Slickly[ .]AI-.*(?:-mac)?\.zip$/i
  };
  const verified = {};
  for (const [manifest, pattern] of Object.entries(manifests)) {
    verified[manifest] = verifyManifest(directory, manifest, pattern);
  }
  return verified;
}

if (require.main === module) {
  try {
    const result = verifyReleasePayload(path.resolve(process.argv[2] || 'release'));
    console.log('PASS: all Windows/Linux/macOS release artifacts, update manifests, referenced files, sizes, SHA-512 hashes, and blockmap are present and consistent.');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { verifyReleasePayload };
