import { config } from './config.js';

/**
 * Appelle un serveur compatible OpenAI (/chat/completions) en streaming.
 * Fonctionne avec Ollama, llama.cpp server, LM Studio, KoboldCpp, vLLM...
 * Renvoie un itérateur asynchrone de fragments de texte.
 */
export async function* streamChat(messages, { signal } = {}) {
  const { baseUrl, model, apiKey, temperature, maxTokens } = config.llm;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, messages, stream: true, temperature, max_tokens: maxTokens }),
  });
  if (!res.ok) {
    throw new Error(`LLM ${res.status} : ${(await res.text()).slice(0, 300)}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        /* ligne SSE incomplète ou non JSON : ignorée */
      }
    }
  }
}
