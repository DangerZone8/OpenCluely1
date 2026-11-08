import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, '..');
const read = relative => fs.readFileSync(path.join(mobileRoot, relative), 'utf8');
const appConfig = JSON.parse(read('app.json')).expo;
const packageConfig = JSON.parse(read('package.json'));
const appSource = read('App.jsx');

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

test('configures Expo to discover the local Slickly native module', () => {
  assert.equal(packageConfig.expo.autolinking.nativeModulesDir, './modules');
  const nativePackage = JSON.parse(read('modules/slickly-native/package.json'));
  const nativeConfig = JSON.parse(read('modules/slickly-native/expo-module.config.json'));
  assert.equal(nativePackage.name, 'slickly-native');
  assert.deepEqual(nativeConfig.platforms, ['android', 'apple']);
});

test('registers a native Android floating overlay with explicit user permission', () => {
  const manifest = read('modules/slickly-native/android/src/main/AndroidManifest.xml');
  const module = read('modules/slickly-native/android/src/main/java/ai/slickly/mobile/SlicklyNativeModule.kt');
  const service = read('modules/slickly-native/android/src/main/java/ai/slickly/mobile/SlicklyOverlayService.kt');
  const nativeConfig = JSON.parse(read('modules/slickly-native/expo-module.config.json'));
  const gradle = read('modules/slickly-native/android/build.gradle');
  assert.ok(nativeConfig.platforms.includes('android'));
  assert.match(gradle, /versionName\s+["']1\.0\.0["']/);
  assert.match(manifest, /SYSTEM_ALERT_WINDOW/);
  assert.match(manifest, /FOREGROUND_SERVICE_SPECIAL_USE/);
  assert.match(manifest, /FOREGROUND_SERVICE_MEDIA_PROJECTION/);
  assert.match(manifest, /SlicklyOverlayService/);
  assert.match(module, /ACTION_MANAGE_OVERLAY_PERMISSION/);
  assert.match(module, /Settings\.canDrawOverlays/);
  assert.match(service, /TYPE_APPLICATION_OVERLAY/);
  assert.match(service, /startForeground/);
  assert.match(service, /slicklyai\.vercel\.app\/api\/gemini/);
});

test('registers iOS ReplayKit broadcast target and app-group context bridge', () => {
  const pickerPlugin = appConfig.plugins.includes('@bacons/apple-targets');
  const appGroups = appConfig.ios.entitlements['com.apple.security.application-groups'];
  const target = JSON.parse(read('targets/screen-broadcast/expo-target.config.json'));
  const handler = read('targets/screen-broadcast/SampleHandler.swift');
  const nativeModule = read('modules/slickly-native/ios/SlicklyNativeModule.swift');
  assert.ok(pickerPlugin, 'Apple target plugin is required for the broadcast extension');
  assert.ok(appGroups.includes('group.ai.slickly.mobile'));
  assert.equal(target.type, 'broadcast-upload');
  assert.equal(target.bundleIdentifier, 'ai.slickly.mobile.SlicklyScreenBroadcast');
  assert.match(handler, /RPBroadcastSampleHandler/);
  assert.match(handler, /processSampleBuffer/);
  assert.match(handler, /latest_screen_ai_context/);
  assert.match(handler, /screen-vision/);
  assert.match(nativeModule, /RPSystemBroadcastPickerView/);
  assert.match(nativeModule, /readLatestScreenContext/);
});

test('exposes platform controls in the phone UI without claiming an iOS system overlay', () => {
  assert.match(appSource, /enableFloatingOverlay/);
  assert.match(appSource, /startAndroidScreenAI/);
  assert.match(appSource, /SlicklyBroadcastPicker/);
  assert.match(appSource, /refreshLatestScreenContext/);
  assert.match(appSource, /Platform\.OS === 'android'/);
});
