'use strict';

const { spawn } = require('node:child_process');

// Electron can inherit this flag from a parent Node process; when set, the
// Electron executable behaves like Node instead of launching the desktop app.
delete process.env.ELECTRON_RUN_AS_NODE;

const electronPath = require('electron');
const electronArgs = process.argv.slice(2);
const child = spawn(electronPath, [...electronArgs, '.'], {
  stdio: 'inherit',
  env: process.env,
});

child.once('error', (error) => {
  console.error('Failed to launch Electron:', error.message);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  if (signal) {
    // Preserve the child process termination signal where the platform allows it.
    try {
      process.kill(process.pid, signal);
    } catch (_) {
      process.exitCode = code ?? 1;
    }
    return;
  }
  process.exitCode = code ?? 1;
});
