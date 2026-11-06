'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourceRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Pass the v1.0.341 source worktree path.');
const file = path.join(sourceRoot, 'src', 'services', 'llm.service.js');
let source = fs.readFileSync(file, 'utf8');

const fallbackLog = 'Local Gemini authentication failed; falling back to hosted Slickly AI';
if (source.includes(fallbackLog)) {
  console.log('PASS: source already contains hosted fallback for invalid local Gemini keys.');
  process.exit(0);
}

const methodStart = source.indexOf('async executeStreamingRequest(');
if (methodStart < 0) throw new Error('Could not find executeStreamingRequest in v1.0.341.');
const methodEnd = source.indexOf('  _streamRequestForModel(', methodStart);
if (methodEnd < 0) throw new Error('Could not determine the end of executeStreamingRequest.');
const method = source.slice(methodStart, methodEnd);

// Windows checkout may convert LF to CRLF. Match either newline style and
// preserve the original indentation rather than depending on logger formatting.
const anchorPattern = /([ \t]*)const errorInfo = this\.analyzeError\(error\);\r?\n[ \t]*lastError = error;/g;
const matches = [...method.matchAll(anchorPattern)];
if (matches.length !== 1) {
  throw new Error('Expected exactly one streaming catch anchor in v1.0.341; found ' + matches.length + '. Refusing an ambiguous patch.');
}
const match = matches[0];
const newline = method.includes('\r\n') ? '\r\n' : '\n';
const indent = match[1];
const patch = [
  '// A stale or invalid local BYOK key must not permanently disable',
  '// hosted Slickly AI. Authentication errors cannot be fixed by retrying',
  '// or changing models, so route the same request through the managed key.',
  "if (errorInfo.type === 'AUTH_ERROR') {",
  "  logger.warn('Local Gemini authentication failed; falling back to hosted Slickly AI', {",
  '    model: modelName,',
  '    errorType: errorInfo.type',
  '  });',
  '  try {',
  '    const hostedText = await this.executeRemoteRequest(geminiRequest, modelName);',
  "    if (typeof onDelta === 'function' && hostedText) onDelta(hostedText);",
  '    return hostedText;',
  '  } catch (proxyError) {',
  "    logger.warn('Hosted AI fallback also failed after local Gemini authentication error', {",
  '      error: proxyError.message',
  '    });',
  "    throw new Error('The configured local Gemini API key was rejected, and hosted Slickly AI fallback failed: ' + proxyError.message);",
  '  }',
  '}',
  ''
].map(line => indent + line).join(newline);

const insertionOffset = methodStart + match.index + match[0].length;
source = source.slice(0, insertionOffset) + newline + patch + source.slice(insertionOffset);
fs.writeFileSync(file, source, 'utf8');

const verifyStart = source.indexOf('async executeStreamingRequest(');
const verifyEnd = source.indexOf('  _streamRequestForModel(', verifyStart);
const verifyMethod = source.slice(verifyStart, verifyEnd);
const occurrences = source.split(fallbackLog).length - 1;
if (!verifyMethod.includes(fallbackLog) || occurrences !== 1) {
  throw new Error('Typed-chat fallback patch verification failed (missing or duplicate insertion).');
}
console.log('PASS: patched v1.0.341 typed-chat streaming to use hosted managed Gemini after local API_KEY_INVALID.');
