'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const pkg = JSON.parse(read('package.json'));
const main = read('main.js');
const windows = read('src/managers/window.manager.js');
const llm = read('src/services/llm.service.js');
const api = read('api/gemini.js');
const favicon = read('webapp/favicon.svg');

assert.strictEqual(pkg.build.win.icon, 'build/icons/icon.ico');
assert.strictEqual(pkg.build.mac.icon, 'build/icons/icon.icns');
assert.strictEqual(pkg.build.linux.icon, 'build/icons/icon.png');
assert.match(favicon, /viewBox="0 0 64 64"/);
assert.match(favicon, /fill="#171916"/);
assert.match(favicon, /stroke="#d5f45b"/);
assert.match(main, /new Tray\(iconPath\)/);
assert.match(main, /Show Slickly AI/);
assert.match(main, /Quit Slickly AI/);
assert.match(main, /this\.setupTray\(\)/);
assert.match(windows, /window\.setOverlayIcon\(nativeImage\.createFromPath\(overlayPath\), 'Slickly AI'\)/);
assert.match(windows, /if \(type === 'main'\) \{[\s\S]*?Keep normal Windows taskbar behavior/);
assert.doesNotMatch(windows, /Main window hidden to the Slickly system tray/);
assert.match(windows, /nativeImage\.createFromPath\(overlayPath\)/);
assert.match(main, /windowManager\.trayAvailable = true/);
assert.match(main, /windowManager\.trayAvailable = false/);
assert.match(windows, /mainWindow\.setSkipTaskbar\(false\)/);
assert.match(llm, /'x-opencluely-stream': '1'/);
assert.match(llm, /contentType\.toLowerCase\(\)\.includes\('text\/event-stream'\)/);
assert.match(llm, /response\.body\.getReader\(\)/);
assert.match(llm, /maxOutputTokens: 2048/);
assert.match(api, /streamGenerateContent\?alt=sse/);
assert.match(api, /text\/event-stream; charset=utf-8/);

execFileSync(process.execPath, [path.join(root, 'scripts', 'generate-app-icons.js')], { stdio: 'inherit' });
const icons = path.join(root, 'build', 'icons');
const png = fs.readFileSync(path.join(icons, 'icon.png'));
const overlay = fs.readFileSync(path.join(icons, 'taskbar-overlay.png'));
const ico = fs.readFileSync(path.join(icons, 'icon.ico'));
assert.deepStrictEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.deepStrictEqual([...overlay.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
assert.strictEqual(overlay.readUInt32BE(16), 16, 'Windows taskbar overlay must be rendered at 16x16 pixels');
assert.strictEqual(overlay.readUInt32BE(20), 16, 'Windows taskbar overlay must be rendered at 16x16 pixels');
assert.strictEqual(ico.readUInt16LE(0), 0);
assert.strictEqual(ico.readUInt16LE(2), 1);
assert.strictEqual(ico.readUInt16LE(4), 1);
assert.strictEqual(ico.readUInt32LE(14), ico.length - 22);
if (process.platform === 'darwin') {
  assert.ok(fs.existsSync(path.join(icons, 'icon.icns')), 'macOS build must generate an ICNS file');
}
console.log('PASS: branded app icons, visible taskbar overlay badge, normal taskbar behavior, and hosted chat streaming contracts.');
