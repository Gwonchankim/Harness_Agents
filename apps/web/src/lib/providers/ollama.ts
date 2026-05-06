import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

import { getSecret } from '@lib/secrets/store';

import type { ProviderAdapter } from './types';

const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';

async function resolveBaseUrl(): Promise<string> {
  const fromStore = await getSecret('OLLAMA_BASE_URL');
  return (fromStore && fromStore.trim()) || DEFAULT_OLLAMA_BASE_URL;
}

export const ollamaAdapter: ProviderAdapter = {
  name: 'ollama',
  getModel(modelId: string) {
    const provider = createOpenAICompatible({
      name: 'ollama',
      baseURL: process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_OLLAMA_BASE_URL,
    });
    return provider(modelId);
  },
  async ping(signal: AbortSignal) {
    const baseUrl = await resolveBaseUrl();
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      method: 'GET',
      signal,
    });
    if (!response.ok) {
      throw new Error(`Ollama ping failed: ${response.status} ${response.statusText}`);
    }
  },
  async isConfigured() {
    // Ollama needs no key; reachability of the base URL is enough.
    return true;
  },
};

export async function buildOllamaModel(modelId: string) {
  const baseUrl = await resolveBaseUrl();
  const provider = createOpenAICompatible({ name: 'ollama', baseURL: baseUrl });
  return provider(modelId);
}
