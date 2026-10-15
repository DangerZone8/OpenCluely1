'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', '.venv-whisper', '.whisper-models']);

function collectJavaScript(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) collectJavaScript(path.join(directory, entry.name), files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(path.join(directory, entry.name));
  }
  return files;
}

const files = collectJavaScript(root);
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log('JavaScript syntax check passed (' + files.length + ' files).');
