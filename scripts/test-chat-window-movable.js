const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('chat.html', 'utf8');
const manager = fs.readFileSync('src/managers/window.manager.js', 'utf8');

assert.match(html, /\.chat-container\s*\{[^}]*-webkit-app-region:\s*no-drag/s,
  'Chat content must remain interactive instead of being a drag surface');
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
console.log('Chat window drag-region checks passed.');
