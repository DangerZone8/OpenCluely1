'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Pass the v1.0.341 source worktree path.');
const file = path.join(sourceRoot, 'main.js');
let source = fs.readFileSync(file, 'utf8');
const marker = 'Using controlled Slickly AI update feed';

if (source.includes(marker)) {
  console.log('PASS: v1.0.341 source already contains the controlled-feed test hook.');
  process.exit(0);
}

const methodStart = source.indexOf('  startAutoUpdates() {');
const methodEnd = source.indexOf('  setupNetworkConfiguration() {', methodStart);
if (methodStart < 0 || methodEnd < 0) {
  throw new Error('Could not isolate startAutoUpdates() in v1.0.341 main.js.');
}
const method = source.slice(methodStart, methodEnd);
const anchor = /([ \t]*)autoUpdater\.autoDownload = true;/g;
const matches = [...method.matchAll(anchor)];
if (matches.length !== 1) {
  throw new Error('Expected exactly one autoUpdater.autoDownload anchor; found ' + matches.length + '. Refusing an ambiguous patch.');
}
const match = matches[0];
const indent = match[1];
const newline = method.includes('\\r\\n') ? '\\r\\n' : '\\n';
const patch = [
  'const controlledFeedUrl = process.env.SLICKLY_UPDATE_URL;',
  'if (controlledFeedUrl) {',
  '  autoUpdater.setFeedURL({ provider: "generic", url: controlledFeedUrl });',
  '  logger.info("Using controlled Slickly AI update feed", { url: controlledFeedUrl });',
  '}'
].map(line => indent + line).join(newline) + newline;
const insertionOffset = methodStart + match.index;
source = source.slice(0, insertionOffset) + patch + source.slice(insertionOffset);
fs.writeFileSync(file, source, 'utf8');

const verifyStart = source.indexOf('  startAutoUpdates() {');
const verifyEnd = source.indexOf('  setupNetworkConfiguration() {', verifyStart);
const verifyMethod = source.slice(verifyStart, verifyEnd);
if (!verifyMethod.includes(marker) || source.split(marker).length - 1 !== 1) {
  throw new Error('Controlled-feed hook patch verification failed.');
}
console.log('PASS: added a test-only SLICKLY_UPDATE_URL override to the v1.0.341 baseline source.');
