// Provider-adapter types. The runtime selects an adapter by ModelCatalog.provider
// and then resolves the actual language-model handle by modelId.

import type { LanguageModelV1 } from 'ai';

export type ProviderName = 'openai' | 'anthropic' | 'ollama';

export interface ProviderAdapter {
  readonly name: ProviderName;
  /** Build a Vercel AI SDK language model handle for the given modelId. */
  getModel(modelId: string): LanguageModelV1;
  /** Cheap reachability check for availability badges. Throws on failure. */
  ping(signal: AbortSignal): Promise<void>;
  /** True if the adapter has the credentials it needs to attempt a call. */
  isConfigured(): Promise<boolean>;
}

export interface AvailabilityResult {
  available: boolean;
  reason?: string;
  latencyMs?: number;
  checkedAt: string;
}
