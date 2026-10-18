const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('chat.html', 'utf8');
const manager = fs.readFileSync('src/managers/window.manager.js', 'utf8');

const containerRule = html.match(/\.chat-container\s*\{([^}]*)\}/s);
assert(containerRule, 'Chat container CSS rule must exist');
assert.match(containerRule[1], /-webkit-app-region:\s*no-drag/,
  'Chat content must remain interactive instead of being a drag surface');
assert.doesNotMatch(containerRule[1], /-webkit-app-region:\s*drag/,
  'Chat container must not override no-drag with a later drag declaration');
assert.match(html, /\.chat-header\s*\{[^}]*-webkit-app-region:\s*drag/s,
  'Chat header must be draggable');
assert.match(html, /\.header-title\s*\{[^}]*-webkit-app-region:\s*drag/s,
  'Chat title/icon must provide a clear drag handle');
assert.match(html, /\.header-actions\s*\{[^}]*-webkit-app-region:\s*no-drag/s,
  'Header actions must remain clickable');
assert.match(html, /\.icon-button\s*\{[^}]*-webkit-app-region:\s*no-drag/s,
  'Header buttons must remain clickable');
assert.match(manager, /else if \(type === 'chat'\)\s*\{[\s\S]*?frame:\s*false,[\s\S]*?resizable:\s*true/,
  'Chat window must remain a frameless, resizable Electron window');
assert.match(manager, /else if \(type === 'main'\)\s*\{[\s\S]*?frame:\s*true,[\s\S]*?transparent:\s*false/,
  'Main app must use a native OS frame for normal window movement and controls');
assert.match(manager, /thickFrame:\s*type === 'main'/,
  'Windows-specific options must preserve the main window native frame');
console.log('Chat window drag-region checks passed.');
