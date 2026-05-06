import { createOpenAI } from '@ai-sdk/openai';

import { getSecret } from '@lib/secrets/store';

import type { ProviderAdapter } from './types';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export const openaiAdapter: ProviderAdapter = {
  name: 'openai',
  getModel(modelId: string) {
    const provider = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY ?? '',
    });
    return provider(modelId);
  },
  async ping(signal: AbortSignal) {
    const apiKey = await getSecret('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    const response = await fetch(`${OPENAI_BASE_URL}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!response.ok) {
      throw new Error(`OpenAI ping failed: ${response.status} ${response.statusText}`);
    }
  },
  async isConfigured() {
    return Boolean(await getSecret('OPENAI_API_KEY'));
  },
};

/**
 * Build a model handle that uses a freshly-resolved API key. Prefer this in
 * the runtime so DB-stored secrets are picked up after the user saves them.
 */
export async function buildOpenAiModel(modelId: string) {
  const apiKey = await getSecret('OPENAI_API_KEY');
  const provider = createOpenAI({ apiKey: apiKey ?? '' });
  return provider(modelId);
}
