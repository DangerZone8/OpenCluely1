'use strict';

const PROVIDERS = {
  gemini: { label: 'Google Gemini', keyEnv: 'GEMINI_API_KEY', modelEnv: 'GEMINI_MODEL', defaultModel: 'gemini-3.1-flash-lite' },
  openai: { label: 'OpenAI', keyEnv: 'OPENAI_API_KEY', modelEnv: 'OPENAI_MODEL', defaultModel: 'gpt-4.1-mini' },
  xai: { label: 'xAI', keyEnv: 'XAI_API_KEY', modelEnv: 'XAI_MODEL', defaultModel: 'grok-3-mini' },
  anthropic: { label: 'Anthropic Claude', keyEnv: 'ANTHROPIC_API_KEY', modelEnv: 'ANTHROPIC_MODEL', defaultModel: 'claude-3-5-haiku-latest' }
};

function getProvider(env = process.env) {
  const provider = String(env.AI_PROVIDER || 'gemini').toLowerCase();
  if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Unsupported AI provider. Choose Gemini, OpenAI, xAI, or Anthropic.');
  return { id: provider, ...PROVIDERS[provider], apiKey: String(env[PROVIDERS[provider].keyEnv] || '').trim(), model: String(env[PROVIDERS[provider].modelEnv] || PROVIDERS[provider].defaultModel).trim() };
}

function extractParts(request) {
  const messages = [];
  const system = request.systemInstruction?.parts?.map(part => part.text || '').filter(Boolean).join('\n').trim();
  if (system) messages.push({ role: 'system', content: system });
  for (const item of request.contents || []) {
    const role = item.role === 'model' || item.role === 'assistant' ? 'assistant' : 'user';
    const parts = (item.parts || []).filter(Boolean);
    const text = parts.filter(part => typeof part.text === 'string').map(part => part.text).join('\n');
    const images = parts.filter(part => part.inlineData?.data && /^image\//i.test(part.inlineData.mimeType || '')).map(part => ({
      type: 'image_url',
      image_url: { url: 'data:' + part.inlineData.mimeType + ';base64,' + part.inlineData.data }
    }));
    const unsupportedAudio = parts.some(part => part.inlineData?.data && /^audio\//i.test(part.inlineData.mimeType || ''));
    if (unsupportedAudio) throw new Error('This provider does not accept raw audio in chat requests. Use the app’s Speech Recognition settings (Whisper/Azure), or choose Gemini/OpenAI for audio analysis.');
    if (images.length) {
      const content = [];
      if (text) content.push({ type: 'text', text });
      content.push(...images);
      messages.push({ role, content });
    } else if (text) {
      messages.push({ role, content: text });
    }
  }
  return messages;
}

async function executeProviderRequest(request, env = process.env, fetchImpl = fetch) {
  const provider = getProvider(env);
  if (provider.id === 'gemini') return null;
  if (!provider.apiKey) throw new Error('Add a ' + provider.label + ' API key in Settings or select a provider with a configured key.');
  const messages = extractParts(request);
  if (!messages.length) throw new Error('AI request has no supported text or image content.');
  const maxTokens = Math.min(Number(request.generationConfig?.maxOutputTokens) || 2048, 8192);
  let response;
  if (provider.id === 'anthropic') {
    const system = messages.find(message => message.role === 'system')?.content;
    const anthropicMessages = messages.filter(message => message.role !== 'system').map(message => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content.flatMap(part =>
        part.type === 'text' ? [{ type: 'text', text: part.text }] :
        part.type === 'image_url' ? [{ type: 'image', source: { type: 'base64', media_type: part.image_url.url.slice(5, part.image_url.url.indexOf(';base64,')), data: part.image_url.url.slice(part.image_url.url.indexOf(';base64,') + 8) } }] : [])
    }));
    response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': provider.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: provider.model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: anthropicMessages })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('Anthropic API HTTP ' + response.status + ': ' + (data.error?.message || 'request failed'));
    return (data.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n').trim();
  }
  const baseUrl = provider.id === 'xai' ? 'https://api.x.ai/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
  response = await fetchImpl(baseUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + provider.apiKey },
    body: JSON.stringify({
      model: provider.model,
      messages,
      max_tokens: maxTokens,
      ...(request.generationConfig?.temperature !== undefined ? { temperature: request.generationConfig.temperature } : {})
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(provider.label + ' API HTTP ' + response.status + ': ' + (data.error?.message || data.error || 'request failed'));
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error(provider.label + ' returned an empty response.');
  return text.trim();
}

module.exports = { PROVIDERS, getProvider, extractParts, executeProviderRequest };
