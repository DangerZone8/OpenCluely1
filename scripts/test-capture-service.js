#!/usr/bin/env node
'use strict';

// Exercise capture-service behavior without requiring a physical desktop.
// Electron and logging are isolated so these tests are deterministic in CI.
const assert = require('node:assert/strict');
const Module = require('node:module');

const electronMock = {
  desktopCapturer: {
    getSources: async () => []
  },
  screen: {
    getAllDisplays: () => [{ id: 1, size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
    getPrimaryDisplay: () => ({ id: 1, size: { width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
  }
};
const loggerMock = {
  createServiceLogger: () => ({
    error() {}, warn() {}, debug() {}, info() {}, logPerformance() {}
  })
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === 'electron') return electronMock;
  if (request === '../core/logger') return loggerMock;
  return originalLoad.call(this, request, parent, isMain);
};

const captureService = require('../src/services/capture.service');
const realCaptureScreenshot = captureService.captureScreenshot.bind(captureService);
Module._load = originalLoad;

function makeImage(width = 100, height = 50) {
  return {
    crop(area) { this.lastCrop = area; return this; },
    toPNG() { return Buffer.from('png-test'); },
    getSize() { return { width, height }; }
  };
}

async function run() {
  assert.equal(captureService._isValidArea({ x: 0, y: 0, width: 10, height: 10 }), true);
  assert.equal(captureService._isValidArea({ x: 0, y: 0, width: 0, height: 10 }), false);
  assert.equal(captureService._isValidArea({ x: NaN, y: 0, width: 10, height: 10 }), false);

  const image = makeImage();
  captureService.captureScreenshot = async () => ({ image, metadata: { displayId: 1 } });
  const result = await captureService.captureAndProcess({ area: { x: 1, y: 2, width: 10, height: 12 } });
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.imageBuffer.toString(), 'png-test');
  assert.deepEqual(image.lastCrop, { x: 1, y: 2, width: 10, height: 12 });
  assert.equal(captureService.isProcessing, false, 'processing lock must clear after success');

  captureService.captureScreenshot = async () => { throw new Error('simulated capture failure'); };
  await assert.rejects(captureService.captureAndProcess(), /simulated capture failure/);
  assert.equal(captureService.isProcessing, false, 'processing lock must clear after failure');

  let releaseCapture;
  captureService.captureScreenshot = () => new Promise(resolve => { releaseCapture = resolve; });
  const pending = captureService.captureAndProcess();
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(captureService.captureAndProcess(), /Capture already in progress/);
  releaseCapture({ image: makeImage(), metadata: { displayId: 1 } });
  await pending;
  assert.equal(captureService.isProcessing, false, 'processing lock must clear after concurrent-call rejection');

  // Explicit display_id must win when monitors have identical dimensions.
  const wrongDisplay = makeImage();
  const intendedDisplay = makeImage();
  electronMock.desktopCapturer.getSources = async () => [
    { name: 'unusable', display_id: '1', thumbnail: null },
    { name: 'secondary', display_id: '2', thumbnail: wrongDisplay },
    { name: 'primary', display_id: '1', thumbnail: intendedDisplay }
  ];
  const targeted = await realCaptureScreenshot({ displayId: 1 });
  assert.equal(targeted.metadata.sourceName, 'primary');
  assert.equal(targeted.image, intendedDisplay);

  // Older platforms may not expose display_id; matching dimensions remains a fallback.
  electronMock.desktopCapturer.getSources = async () => [
    { name: 'wrong-size', thumbnail: { getSize: () => ({ width: 800, height: 600 }) } },
    { name: 'size-match', thumbnail: makeImage(1920, 1080) }
  ];
  const fallback = await realCaptureScreenshot({ displayId: 1 });
  assert.equal(fallback.metadata.sourceName, 'size-match');

  electronMock.desktopCapturer.getSources = async () => [];
  await assert.rejects(realCaptureScreenshot(), /No screen sources available/);
  electronMock.desktopCapturer.getSources = async () => [
    { name: 'no-thumbnail', display_id: '1', thumbnail: null }
  ];
  await assert.rejects(realCaptureScreenshot(), /No usable screen thumbnails available/);

  console.log('Capture service tests passed: area validation, crop/output, failure recovery, concurrency guard, display selection, fallback matching, and empty-source handling.');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
