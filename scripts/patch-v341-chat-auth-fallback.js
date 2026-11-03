'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Pass the v1.0.341 source worktree path.');
const file = path.join(sourceRoot, 'src', 'services', 'llm.service.js');
let source = fs.readFileSync(file, 'utf8');

const marker = `          const errorInfo = this.analyzeError(error);
          lastError = error;

          logger.warn(\`Gemini streaming attempt \${attempt} failed for model \${modelName}\`, {`;
if (source.includes("Local Gemini authentication failed; falling back to hosted Slickly AI")) {
  console.log('PASS: v1.0.341 source already contains hosted fallback for invalid local Gemini keys.');
  process.exit(0);
}
if (!source.includes(marker)) {
  throw new Error('Could not find the v1.0.341 streaming error handler insertion point; refusing to patch an unexpected source revision.');
}

const replacement = `          const errorInfo = this.analyzeError(error);
          lastError = error;

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

          logger.warn(\`Gemini streaming attempt \${attempt} failed for model \${modelName}\`, {`;
source = source.replace(marker, replacement);
fs.writeFileSync(file, source, 'utf8');
console.log('PASS: patched v1.0.341 typed-chat streaming to fall back to the hosted managed Gemini key after local API_KEY_INVALID.');
