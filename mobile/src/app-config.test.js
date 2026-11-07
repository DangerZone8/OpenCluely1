import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, '..');
const appConfig = JSON.parse(fs.readFileSync(path.join(mobileRoot, 'app.json'), 'utf8')).expo;
const appSource = fs.readFileSync(path.join(mobileRoot, 'App.jsx'), 'utf8');

test('declares distinct native Android and iOS application identifiers', () => {
  assert.equal(appConfig.android.package, 'ai.slickly.mobile');
  assert.equal(appConfig.ios.bundleIdentifier, 'ai.slickly.mobile');
  assert.equal(appConfig.name, 'Slickly');
  assert.equal(appConfig.slug, 'slickly');
});

test('provides generated app and adaptive icons before Expo export', () => {
  for (const asset of [appConfig.icon, appConfig.android.adaptiveIcon.foregroundImage]) {
    const assetPath = path.resolve(mobileRoot, asset);
    assert.ok(fs.existsSync(assetPath), `Missing generated mobile asset: ${asset}`);
    assert.ok(fs.statSync(assetPath).size > 100, `Mobile asset is unexpectedly empty: ${asset}`);
  }
});

test('imports the React Native Image component used by the branded app header', () => {
  assert.match(appSource, /import\s*\{[\s\S]*?\bImage\b[\s\S]*?\}\s*from\s*['"]react-native['"]/);
});

test('configures screenshot selection permissions for native Screen AI', () => {
  const picker = appConfig.plugins.find(plugin => Array.isArray(plugin) && plugin[0] === 'expo-image-picker');
  assert.ok(picker, 'expo-image-picker config plugin is required');
  assert.match(picker[1].photosPermission, /screenshots/i);
  assert.match(appSource, /requestScreenAnalysis/);
  assert.match(appSource, /screen-vision|Screen AI/);
});
