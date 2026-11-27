'use strict';

const assert = require('node:assert/strict');
const llmService = require('../src/services/llm.service');

async function run() {
  llmService.isInitialized = true;
  let capturedRequest;
  let emitted = '';
  llmService.executeStreamingRequest = async (request, onDelta) => {
    capturedRequest = request;
    onDelta('Hey there!');
    return 'Hey there! How can I help?';
  };

  const result = await llmService.processGeneralAssistantStream(
    'What about the second option?',
    [
      { role: 'user', content: 'Which option is cheaper?' },
      { role: 'model', content: 'Option B is cheaper.' },
      { role: 'user', content: 'What about the second option?' }
    ],
    (delta) => { emitted += delta; }
  );

  assert.equal(result.response, 'Hey there! How can I help?');
  assert.equal(emitted, 'Hey there!');
  assert.equal(capturedRequest.contents.length, 3, 'Recent conversation should be passed to Gemini');
  assert.equal(capturedRequest.contents[1].role, 'model');
  assert.equal(capturedRequest.contents[1].parts[0].text, 'Option B is cheaper.');
  assert.match(capturedRequest.systemInstruction.parts[0].text, /You are Slickly AI/);
  assert.match(capturedRequest.systemInstruction.parts[0].text, /never as OpenCluely/);
  assert.match(capturedRequest.systemInstruction.parts[0].text, /Respond naturally/);
  assert.match(capturedRequest.systemInstruction.parts[0].text, /recent conversation as one continuous discussion/);
  const voicePrompt = capturedRequest.systemInstruction.parts[0].text;
  assert.match(voicePrompt, /one continuous discussion/);
  assert.match(voicePrompt, /VOICE INPUT/);
  assert.match(voicePrompt, /Answer the direct question/);
  assert.match(voicePrompt, /understandable steps/);
  assert.match(voicePrompt, /ask one short clarifying question/);

  const longHistory = Array.from({ length: 18 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'model',
    content: `Turn ${index + 1}`,
    skill: 'general'
  }));
  let longHistoryRequest;
  llmService.executeStreamingRequest = async (request) => {
    longHistoryRequest = request;
    return 'Context retained.';
  };
  await llmService.processGeneralAssistantStream('Current follow-up', longHistory);
  assert.equal(longHistoryRequest.contents.length, 17, 'Keep the latest 16 history turns plus the current user message.');
  assert.equal(longHistoryRequest.contents[0].parts[0].text, 'Turn 3', 'Discard only history older than the 16-turn context window.');
  assert.equal(longHistoryRequest.contents.at(-1).parts[0].text, 'Current follow-up');
  const mixedSkillHistory = [
    { role: 'user', content: 'Solve this graph problem', skill: 'dsa' },
    { role: 'model', content: 'This appears to be a data structures and algorithms problem. Consider breaking it down into smaller components and identifying the appropriate algorithm or data structure to use.', skill: 'dsa' },
    { role: 'user', content: 'Earlier I asked about lunch.', skill: 'general' },
    { role: 'model', content: 'We were discussing lunch options.', skill: 'general' }
  ];
  let isolatedRequest;
  llmService.executeStreamingRequest = async (request) => { isolatedRequest = request; return 'Hello!'; };
  await llmService.processGeneralAssistantStream('hi', mixedSkillHistory);
  assert.deepEqual(isolatedRequest.contents.map(item => item.parts[0].text), [
    'Earlier I asked about lunch.',
    'We were discussing lunch options.',
    'hi'
  ], 'General chat must not inherit DSA-specific history or canned coding responses.');
  assert.doesNotMatch(JSON.stringify(isolatedRequest.contents), /data structures and algorithms|graph problem/i);

  // A spoken follow-up must retain the earlier spoken question and the
  // assistant's reply, not just the latest Whisper transcript.
  let voiceFollowUpRequest;
  llmService.executeStreamingRequest = async (request) => {
    voiceFollowUpRequest = request;
    return 'Because it follows from the earlier voice turn.';
  };
  await llmService.processGeneralAssistantStream('Why is that the better choice?', [
    { role: 'user', content: 'I am comparing two database options for Slickly.', skill: 'general', action: 'speech_transcription' },
    { role: 'model', content: 'Option B is better for your current scale.', skill: 'general', action: 'llm_response' },
    { role: 'user', content: 'Why is that the better choice?', skill: 'general', action: 'speech_transcription' }
  ], null, 'voice');
  assert.deepEqual(voiceFollowUpRequest.contents.map(item => item.parts[0].text), [
    'I am comparing two database options for Slickly.',
    'Option B is better for your current scale.',
    'Why is that the better choice?'
  ], 'Voice follow-up must retain the prior spoken question and answer.');

  // Guard the main-process wiring: fragments are displayed immediately but
  // only the coalesced utterance is added to session memory once.
  const fs = require('node:fs');
  const mainSource = fs.readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(mainSource, /sessionManager\.addUserInput\(cleanText, 'speech', 'general'\)/,
    'The complete coalesced voice utterance must be persisted as one user turn.');
  assert.doesNotMatch(mainSource, /addUserInput\(fragment, 'speech', 'general'\)/,
    'Individual speech fragments must not consume separate history entries.');
  assert.match(mainSource, /getConversationHistory\(32\)/,
    'Voice requests must request enough history to preserve several complete exchanges.');

  let identityCalls = 0;
  const originalExecute = llmService.executeStreamingRequest;
  llmService.executeStreamingRequest = async () => { identityCalls++; return 'unexpected'; };
  const identityDeltas = [];
  const identity = await llmService.processGeneralAssistantStream("Hey, what do I call you?", [], delta => identityDeltas.push(delta));
  llmService.executeStreamingRequest = originalExecute;
  assert.equal(identity.response, "I'm Slickly AI, your AI assistant.");
  assert.deepEqual(identityDeltas, ["I'm Slickly AI, your AI assistant."]);
  assert.equal(identityCalls, 0, 'identity questions must not call Gemini or consume API quota');
  console.log('General assistant context, Slickly AI identity, and streaming tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
