// Agent runtime — three split functions per the Phase 1 contract. We never
// expose a single `complete` overload. Callers pick the function that matches
// what they need (streamed tokens, structured object, or just availability).

import {
  generateObject as aiGenerateObject,
  streamText as aiStreamText,
  type CoreMessage,
} from 'ai';
import type { z } from 'zod';

import { redactString } from '@lib/secrets/redactor';

import { buildModel, getProviderByName, isProviderName } from '@lib/providers';
import type { AvailabilityResult, ProviderName } from '@lib/providers';

export interface StreamTextArgs {
  provider: ProviderName;
  modelId: string;
  messages: CoreMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface GenerateObjectArgs<T> {
  provider: ProviderName;
  modelId: string;
  schema: z.ZodType<T>;
  messages: CoreMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export async function streamText(args: StreamTextArgs) {
  const model = await buildModel(args.provider, args.modelId);
  return aiStreamText({
    model,
    messages: args.messages,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
    abortSignal: args.signal,
  });
}

export async function generateObject<T>(args: GenerateObjectArgs<T>) {
  const model = await buildModel(args.provider, args.modelId);
  return aiGenerateObject({
    model,
    schema: args.schema,
    messages: args.messages,
    temperature: args.temperature,
    maxTokens: args.maxTokens,
    abortSignal: args.signal,
  });
}

const PING_TIMEOUT_MS = 3000;

/**
 * Probe a single provider for reachability. Errors are caught and converted
 * into `{available: false, reason}`. The result string is redacted so a stray
 * token in an error message can't leak.
 */
export async function checkProviderAvailability(provider: string): Promise<AvailabilityResult> {
  const checkedAt = new Date().toISOString();
  if (!isProviderName(provider)) {
    return { available: false, reason: `unknown provider: ${provider}`, checkedAt };
  }
  const adapter = getProviderByName(provider);
  if (!(await adapter.isConfigured())) {
    return { available: false, reason: 'not configured', checkedAt };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  const start = Date.now();
  try {
    await adapter.ping(controller.signal);
    return { available: true, latencyMs: Date.now() - start, checkedAt };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      available: false,
      reason: redactString(reason).slice(0, 240),
      latencyMs: Date.now() - start,
      checkedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Convenience: availability for a specific model — by-provider check only. */
export async function checkModelAvailability(
  provider: string,
  _modelId: string,
): Promise<AvailabilityResult> {
  return checkProviderAvailability(provider);
}
