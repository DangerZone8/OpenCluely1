const DEFAULT_API_URL = 'https://slicklyai.vercel.app/api/gemini';

export function buildGeminiPayload(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('Add a message before sending.');
  }

  const contents = messages
    .filter(message => message && typeof message.text === 'string' && message.text.trim())
    .slice(-20)
    .map(message => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.text.trim() }]
    }));

  if (!contents.length) throw new Error('There is no message content to send.');

  return {
    request: {
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048
      }
    }
  };
}

export async function requestAssistantReply({
  messages,
  installId,
  fetchImpl = fetch,
  apiUrl = DEFAULT_API_URL
}) {
  if (typeof installId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(installId)) {
    throw new Error('The app could not initialize its secure installation identifier. Restart Slickly and try again.');
  }

  const response = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-opencluely-install-id': installId,
      'x-opencluely-feature': 'chat'
    },
    body: JSON.stringify(buildGeminiPayload(messages))
  });

  let result = {};
  try {
    result = await response.json();
  } catch {
    throw new Error('Slickly received an unreadable response. Please try again.');
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('The shared AI service is busy or its usage limit has been reached. Please wait and try again.');
    }
    if (response.status === 503) {
      throw new Error('The hosted AI service is temporarily unavailable. Please try again later.');
    }
    throw new Error(typeof result.error === 'string' ? result.error : 'Slickly could not complete that request.');
  }

  if (typeof result.text !== 'string' || !result.text.trim()) {
    throw new Error('The AI service returned an empty answer. Please try again.');
  }

  return result.text.trim();
}

export { DEFAULT_API_URL };
