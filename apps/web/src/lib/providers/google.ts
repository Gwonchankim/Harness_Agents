import { createGoogleGenerativeAI } from '@ai-sdk/google';

import { getSecret } from '@lib/secrets/store';

import type { ProviderAdapter } from './types';

const GOOGLE_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const googleAdapter: ProviderAdapter = {
  name: 'google',
  getModel(modelId: string) {
    const provider = createGoogleGenerativeAI({
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
    });
    return provider(modelId);
  },
  async ping(signal: AbortSignal) {
    const apiKey = await getSecret('GOOGLE_GENERATIVE_AI_API_KEY');
    if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY is not configured');
    const response = await fetch(GOOGLE_MODELS_URL, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Google ping failed: ${response.status} ${response.statusText}`);
    }
  },
  async isConfigured() {
    return Boolean(await getSecret('GOOGLE_GENERATIVE_AI_API_KEY'));
  },
};

export async function buildGoogleModel(modelId: string) {
  const apiKey = await getSecret('GOOGLE_GENERATIVE_AI_API_KEY');
  const provider = createGoogleGenerativeAI({ apiKey: apiKey ?? '' });
  return provider(modelId);
}
