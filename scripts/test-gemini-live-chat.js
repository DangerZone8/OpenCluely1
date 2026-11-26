'use strict';

const assert = require('node:assert/strict');
const llmService = require('../src/services/llm.service');

async function withTransientRetry(label, operation) {
  try {
    return await operation();
  } catch (error) {
    const message = String(error?.message || error);
    if (!/(timed out|connection timed out|fetch failed|network error|HTTP 5\d\d)/i.test(message)) throw error;
    console.warn('Transient live ' + label + ' failure; retrying once:', message.slice(0, 220));
    await new Promise(resolve => setTimeout(resolve, 2000));
    return operation();
  }
}

function makeToneWav() {
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
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const amplitude = Math.round(Math.sin(2 * Math.PI * 440 * sample / sampleRate) * 0.2 * 32767);
    wav.writeInt16LE(amplitude, 44 + sample * 2);
  }
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
  const response = await withTransientRetry('chat', () => llmService.executeRemoteRequest({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 24 }
  }));

  assert.equal(typeof response, 'string', 'Hosted Gemini chat must return text');
  assert.ok(response.trim().length > 0,
    'Hosted Gemini chat must return a non-empty real model response');

  // Exercise the same authenticated hosted path with a short audible 440 Hz tone.
  // It validates audio transport/provider handling without embedding a human recording.
  const audio = await withTransientRetry('audio', () =>
    llmService.processAudioWithGemini(makeToneWav(), 'audio/wav'));
  assert.equal(typeof audio.response, 'string', 'Hosted voice analysis must return text');
  assert.ok(audio.response.trim().length > 0,
    'Hosted voice analysis must return a non-empty response for a valid audio clip');
  assert.doesNotMatch(audio.response, /haven't attached|have not attached|please upload.*audio|provide the audio clip/i,
    'Hosted voice analysis must recognize that the audio payload was actually attached: ' + audio.response);

  // Exercise the actual general-assistant prompt/history path through the
  // hosted provider, not just a raw marker request with no system instruction.
  let greeting;
  try {
    greeting = await withTransientRetry('general assistant', () =>
      llmService.processGeneralAssistantStream('hi', []));
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
