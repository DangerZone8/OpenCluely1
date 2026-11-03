'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Pass the v1.0.341 source worktree path.');
const file = path.join(sourceRoot, 'src', 'services', 'llm.service.js');
let source = fs.readFileSync(file, 'utf8');

const fallbackLog = "Local Gemini authentication failed; falling back to hosted Slickly AI";
if (source.includes(fallbackLog)) {
  console.log('PASS: source already contains hosted fallback for invalid local Gemini keys.');
  process.exit(0);
}

// Anchor within executeStreamingRequest rather than matching a formatted
// logger template. v1.0.341's tagged source has a slightly different logger
// layout than main, so matching the whole following logger call was brittle.
const streamingStart = source.indexOf('async executeStreamingRequest(');
if (streamingStart < 0) {
  throw new Error('Could not find executeStreamingRequest in the v1.0.341 source.');
}
const anchor = '          const errorInfo = this.analyzeError(error);\\n          lastError = error;\\n';
const anchorIndex = source.indexOf(anchor, streamingStart);
if (anchorIndex < 0) {
  throw new Error('Could not find the v1.0.341 streaming catch block; refusing to patch an unexpected source revision.');
}
const afterAnchor = anchorIndex + anchor.length;
const patch = `
          // A stale or invalid local BYOK key must not permanently disable
          // hosted Slickly AI. Authentication errors cannot be fixed by retrying
          // or changing models, so route the same request through the managed key.
          if (errorInfo.type === 'AUTH_ERROR') {
            logger.warn('Local Gemini authentication failed; falling back to hosted Slickly AI', {
              model: modelName,
              errorType: errorInfo.type
            });
            try {
              const hostedText = await this.executeRemoteRequest(geminiRequest, modelName);
              if (typeof onDelta === 'function' && hostedText) onDelta(hostedText);
              return hostedText;
            } catch (proxyError) {
              logger.warn('Hosted AI fallback also failed after local Gemini authentication error', {
                error: proxyError.message
              });
              throw new Error('The configured local Gemini API key was rejected, and hosted Slickly AI fallback failed: ' + proxyError.message);
            }
          }
`;
source = source.slice(0, afterAnchor) + patch + source.slice(afterAnchor);
fs.writeFileSync(file, source, 'utf8');

// Verify the patch is present exactly once and remains inside the streaming method.
const patchedStreamingStart = source.indexOf('async executeStreamingRequest(');
const patchedStreamingEnd = source.indexOf('  _streamRequestForModel(', patchedStreamingStart);
const streamingBody = source.slice(patchedStreamingStart, patchedStreamingEnd < 0 ? undefined : patchedStreamingEnd);
const occurrences = source.split(fallbackLog).length - 1;
if (!streamingBody.includes(fallbackLog) || occurrences !== 1) {
  throw new Error('Typed-chat fallback patch verification failed (missing or duplicate insertion).');
}
console.log('PASS: patched v1.0.341 typed-chat streaming to use hosted managed Gemini after local API_KEY_INVALID.');
