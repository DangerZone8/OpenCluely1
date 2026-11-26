'use strict';

const assert = require('node:assert/strict');
const llmService = require('../src/services/llm.service');

function makeSilentWav() {
  const sampleRate = 16000;
  const sampleCount = sampleRate / 2;
  const dataBytes = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataBytes, 40);
  return wav;
}

async function main() {
  // Exercise the same hosted Gemini proxy used by keyless desktop screen/audio
  // flows. This is a real provider-backed request, not a mock, but deliberately
  // uses one provider call so CI does not burn a multi-turn quota budget on every push.
  const accessToken = process.env.SLICKLY_E2E_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error('Authenticated CI session is missing. Run scripts/create-slickly-test-session.js first.');
  }
  const previousRemoteOnly = llmService.remoteOnly;
  llmService.remoteOnly = true;
  llmService.setAccountAccessTokenProvider(() => accessToken);

  const prompt = 'Reply with exactly LIVE_GEMINI_CHAT_OK and no other text.';
  const response = await llmService.executeRemoteRequest({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 24 }
  });

  assert.equal(typeof response, 'string', 'Hosted Gemini chat must return text');
  assert.ok(response.trim().length > 0,
    'Hosted Gemini chat must return a non-empty real model response');

  // Exercise the same authenticated hosted path with a small valid WAV payload.
  // Silence is intentional: the test verifies the audio transport/provider path
  // without embedding a human recording or spending a long transcription budget.
  const audio = await llmService.processAudioWithGemini(makeSilentWav(), 'audio/wav');
  assert.equal(typeof audio.response, 'string', 'Hosted voice analysis must return text');
  assert.ok(audio.response.trim().length > 0,
    'Hosted voice analysis must return a non-empty response for a valid audio clip');

  // Exercise the actual general-assistant prompt/history path through the
  // hosted provider, not just a raw marker request with no system instruction.
  let greeting;
  try {
    greeting = await llmService.processGeneralAssistantStream('hi', []);
  } finally {
    llmService.remoteOnly = previousRemoteOnly;
    llmService.setAccountAccessTokenProvider(null);
  }
  assert.equal(typeof greeting.response, 'string', 'General assistant must return a real greeting');
  assert.ok(greeting.response.trim().length > 0, 'General assistant greeting must not be empty');
  assert.match(greeting.response, /\b(hi|hello|hey|help|assist)\b/i,
    'A plain greeting should receive a conversational reply: ' + greeting.response);
  assert.doesNotMatch(greeting.response, /data structures and algorithms|algorithm or data structure|consider breaking it down into smaller components/i,
    'A plain greeting must not receive the canned DSA answer: ' + greeting.response);

  console.log(JSON.stringify({
    status: 'PASS',
    provider: 'Live Gemini through hosted Cleverly AI proxy (not mocked)',
    providerRequests: 3,
    response,
    audioAnalysis: audio.response.slice(0, 180),
    generalGreeting: greeting.response
  }, null, 2));
}

main().catch((error) => {
  console.error('LIVE GEMINI CHAT TEST FAILED:', error.message);
  process.exitCode = 1;
});
