import { anthropicAdapter, buildAnthropicModel } from './anthropic';
import { ollamaAdapter, buildOllamaModel } from './ollama';
import { openaiAdapter, buildOpenAiModel } from './openai';

import type { ProviderAdapter, ProviderName } from './types';

export type { ProviderAdapter, ProviderName, AvailabilityResult } from './types';

const ADAPTERS: Record<ProviderName, ProviderAdapter> = {
  openai: openaiAdapter,
  anthropic: anthropicAdapter,
  ollama: ollamaAdapter,
};

export function getProviderByName(name: string): ProviderAdapter {
  if (!isProviderName(name)) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return ADAPTERS[name];
}

export function listProviders(): readonly ProviderAdapter[] {
  return Object.values(ADAPTERS);
}

export function isProviderName(name: string): name is ProviderName {
  return name === 'openai' || name === 'anthropic' || name === 'ollama';
}

/** Build a language-model handle, picking up DB-stored secrets at call time. */
export async function buildModel(provider: ProviderName, modelId: string) {
  switch (provider) {
    case 'openai':
      return buildOpenAiModel(modelId);
    case 'anthropic':
      return buildAnthropicModel(modelId);
    case 'ollama':
      return buildOllamaModel(modelId);
  }
}
