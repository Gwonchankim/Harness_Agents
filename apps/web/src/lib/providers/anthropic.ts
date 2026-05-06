import { createAnthropic } from '@ai-sdk/anthropic';

import { getSecret } from '@lib/secrets/store';

import type { ProviderAdapter } from './types';

const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';

export const anthropicAdapter: ProviderAdapter = {
  name: 'anthropic',
  getModel(modelId: string) {
    const provider = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? '' });
    return provider(modelId);
  },
  async ping(signal: AbortSignal) {
    const apiKey = await getSecret('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
    const modelsResp = await fetch(`${ANTHROPIC_BASE_URL}/models`, {
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal,
    });
    if (modelsResp.ok) return;
    if (modelsResp.status !== 404) {
      throw new Error(`Anthropic ping failed: ${modelsResp.status} ${modelsResp.statusText}`);
    }
    // Fallback: minimal messages probe (1 output token).
    const probe = await fetch(`${ANTHROPIC_BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      signal,
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    if (!probe.ok) {
      throw new Error(`Anthropic probe failed: ${probe.status} ${probe.statusText}`);
    }
  },
  async isConfigured() {
    return Boolean(await getSecret('ANTHROPIC_API_KEY'));
  },
};

export async function buildAnthropicModel(modelId: string) {
  const apiKey = await getSecret('ANTHROPIC_API_KEY');
  const provider = createAnthropic({ apiKey: apiKey ?? '' });
  return provider(modelId);
}
