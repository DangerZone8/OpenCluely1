'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'src/managers/window.manager.js'), 'utf8');
const failures = [];

function requireMatch(source, pattern, message) {
  if (!pattern.test(source)) failures.push(message);
}
function forbidMatch(source, pattern, message) {
  if (pattern.test(source)) failures.push(message);
}

// The overlay must not be shown as a side effect of app startup/window creation.
requireMatch(main, /initializeWindows\(\s*\{\s*showMainWindow:\s*!isFirstRun\s*\}\s*\)/,
  'Returning users must see the main window on startup while first-run onboarding keeps the overlay hidden.');
requireMatch(manager, /async initializeWindows\(options\s*=\s*\{\}\)\s*\{\s*const\s*\{\s*showMainWindow\s*=\s*false\s*\}\s*=\s*options;/,
  'initializeWindows must default to hidden.');
requireMatch(manager, /async createMainWindow\(\)\s*\{/,
  'createMainWindow must not accept an implicit auto-show option.');
forbidMatch(manager, /setTimeout\(\(\)\s*=>\s*\{\s*this\.showOnCurrentDesktop\(window\);/,
  'Window creation must not schedule a delayed implicit show.');

// A newer hide must invalidate a previously scheduled show, especially on macOS.
requireMatch(manager, /mainVisibilityGeneration\s*\+=\s*1/,
  'Hiding the overlay must invalidate queued show operations.');
requireMatch(manager, /showGeneration\s*!==\s*this\.mainVisibilityGeneration/,
  'Delayed main-window show operations must verify their generation.');
requireMatch(manager, /hideAllWindows\(\)\s*\{\s*this\.isVisible\s*=\s*false;/,
  'hideAllWindows must clear visible state before hiding windows.');
requireMatch(manager, /hideAllWindows\(\)\s*\{[\s\S]*?this\.windows\.forEach\(\(window\)\s*=>\s*\{\s*if\s*\(!window\.isDestroyed\(\)\)\s*window\.hide\(\);/,
  'Disabling the overlay must hide every live overlay window.');
requireMatch(manager, /showAllWindows\(\)\s*\{[\s\S]*?this\.isVisible\s*=\s*true;[\s\S]*?this\.showOnCurrentDesktop\(window\)/,
  'Explicitly enabling the overlay must set state before scheduling window shows.');

// The user-facing toggle must switch state in both directions and must not
// mutate visibility while screen sharing is active.
requireMatch(manager, /toggleVisibility\(\)\s*\{[\s\S]*?if\s*\(this\.isScreenBeingShared\)\s*\{\s*return this\.isVisible;\s*\}[\s\S]*?if\s*\(this\.isVisible\)\s*\{\s*this\.hideAllWindows\(\);\s*\}\s*else\s*\{\s*this\.showAllWindows\(\);\s*\}[\s\S]*?return this\.isVisible;/,
  'Toggle must hide when enabled, show when disabled, and preserve state during screen sharing.');
requireMatch(manager, /showMainWindow\(\)[\s\S]*?const showGeneration = \+\+this\.mainVisibilityGeneration;[\s\S]*?showGeneration !== this\.mainVisibilityGeneration/,
  'A stale delayed main-window show must not override a newer hide request.');
requireMatch(manager, /hideAllWindows\(\)\s*\{[\s\S]*?this\.isVisible\s*=\s*false;[\s\S]*?this\.windows\.forEach\(\(window\)\s*=>\s*\{\s*if\s*\(!window\.isDestroyed\(\)\)\s*window\.hide\(\);/,
  'Hide must close every live overlay window, including the AI-response window.');

if (failures.length) {
  console.error('Overlay visibility regression checks failed:');
  for (const failure of failures) console.error(' - ' + failure);
  process.exitCode = 1;
} else {
  console.log('Overlay visibility regression checks passed.');
}
