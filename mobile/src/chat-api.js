const DEFAULT_API_URL = 'https://slicklyai.vercel.app/api/gemini';

function contentsFromMessages(messages) {
  return messages
    .filter(message => message && typeof message.text === 'string' && message.text.trim())
    .slice(-20)
    .map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.text.trim() }]
    }));
}

export function buildGeminiPayload(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Add a message before sending.');
  }
  const contents = contentsFromMessages(messages);
  if (!contents.length) throw new Error('There is no message content to send.');
  return { request: { contents, generationConfig: { temperature: 0.7, maxOutputTokens: 2048 } } };
}

function assertInstallId(installId) {
  if (typeof installId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installId)) {
    throw new Error('The app could not initialize its secure installation identifier. Restart Slickly and try again.');
  }
}

async function postGemini({ payload, installId, feature, fetchImpl, apiUrl }) {
  assertInstallId(installId);
  const response = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-opencluely-install-id': installId,
      'x-opencluely-feature': feature
    },
    body: JSON.stringify(payload)
  });
  let result = {};
  try { result = await response.json(); }
  catch { throw new Error('Slickly received an unreadable response. Please try again.'); }
  if (!response.ok) {
    if (response.status === 429) throw new Error('The shared AI service is busy or its usage limit has been reached. Please wait and try again.');
    if (response.status === 503) throw new Error('The hosted AI service is temporarily unavailable. Please try again later.');
    throw new Error(typeof result.error === 'string' ? result.error : 'Slickly could not complete that request.');
  }
  if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('The AI service returned an empty answer. Please try again.');
  return result.text.trim();
}

export function requestAssistantReply({ messages, installId, fetchImpl = fetch, apiUrl = DEFAULT_API_URL }) {
  return postGemini({
    payload: buildGeminiPayload(messages),
    installId,
    feature: 'chat',
    fetchImpl,
    apiUrl
  });
}

export function buildScreenVisionPayload({ imageBase64, mimeType = 'image/jpeg', prompt, history = [] }) {
  if (typeof imageBase64 !== 'string' || !imageBase64.trim()) throw new Error('Choose a screenshot before starting Screen AI.');
  const contents = contentsFromMessages(history);
  contents.push({
    role: 'user',
    parts: [
      { text: prompt || 'Describe the important information visible in this screenshot. Read any visible question and explain what it is asking. Keep the result useful for follow-up questions.' },
      { inlineData: { mimeType, data: imageBase64 } }
    ]
  });
  return { request: { contents, generationConfig: { temperature: 0.4, maxOutputTokens: 2048 } } };
}

export function requestScreenAnalysis({ imageBase64, mimeType, prompt, history = [], installId, fetchImpl = fetch, apiUrl = DEFAULT_API_URL }) {
  return postGemini({
    payload: buildScreenVisionPayload({ imageBase64, mimeType, prompt, history }),
    installId,
    feature: 'screen-vision',
    fetchImpl,
    apiUrl
  });
}

export { DEFAULT_API_URL };
