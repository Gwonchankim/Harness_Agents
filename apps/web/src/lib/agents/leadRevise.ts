// Lead revision call — wraps runtime.generateObject for the team-improvement
// proposal. Reuses the PO/Team error classes + the Phase 2 timeout, exactly like
// lead.ts / team.ts. Never persists anything; callers own DB writes.

import { generateObject } from '@lib/agents/runtime';
import {
  getEnabledModelOrThrow,
  invalidateProviderAvailability,
  resolveProviderName,
  UnknownProviderError,
} from '@lib/models/catalog';
import { redactString } from '@lib/secrets/redactor';

import {
  GenerateAbortedError,
  GenerateTimeoutError,
  resolvePoGenerateTimeoutMs,
  runWithGenerateTimeout,
} from '@lib/qa/timeout';

import { PoAuthError, PoSchemaError, ProviderUnavailableError } from './po';
import {
  buildLeadReviseMessages,
  teamRevisionSchema,
  type LeadRevisePromptInput,
  type TeamRevisionPayload,
} from './leadRevise.prompt';

export type { TeamRevisionPayload };

export interface LeadReviseCtx extends LeadRevisePromptInput {
  /** Lead model id — comes from the lead Agent row. */
  modelId: string;
  signal?: AbortSignal;
}

export async function proposeTeamImprovement(ctx: LeadReviseCtx): Promise<TeamRevisionPayload> {
  const provider = await resolveProvider(ctx.modelId);
  const messages = buildLeadReviseMessages(ctx);
  try {
    return await callRevise(provider, ctx.modelId, messages, ctx.signal);
  } catch (err) {
    if (!(err instanceof PoSchemaError)) throw err;
    return callRevise(
      provider,
      ctx.modelId,
      buildLeadReviseMessages({ ...ctx, strict: true }),
      ctx.signal,
    );
  }
}

async function callRevise(
  provider: 'openai' | 'anthropic' | 'google' | 'ollama',
  modelId: string,
  messages: ReturnType<typeof buildLeadReviseMessages>,
  signal?: AbortSignal,
): Promise<TeamRevisionPayload> {
  const timeoutMs = resolvePoGenerateTimeoutMs(provider);
  try {
    const result = await runWithGenerateTimeout(
      signal,
      async (composite) =>
        generateObject<TeamRevisionPayload>({
          provider,
          modelId,
          schema: teamRevisionSchema,
          messages,
          temperature: 0.4,
          maxTokens: 2048,
          signal: composite,
        }),
      timeoutMs,
    );
    return (result as { object: TeamRevisionPayload }).object;
  } catch (err) {
    if (err instanceof GenerateAbortedError) throw err;
    if (err instanceof GenerateTimeoutError) {
      throw new GenerateTimeoutError(err.timeoutMs, { provider, modelId });
    }
    const status = extractAuthStatus(err);
    if (status != null) {
      invalidateProviderAvailability(provider);
      throw new PoAuthError(provider, status);
    }
    if (looksLikeSchemaError(err)) {
      throw new PoSchemaError(err);
    }
    invalidateProviderAvailability(provider);
    throw new ProviderUnavailableError(
      provider,
      err instanceof Error ? redactString(err.message).slice(0, 240) : String(err),
    );
  }
}

async function resolveProvider(
  modelId: string,
): Promise<'openai' | 'anthropic' | 'google' | 'ollama'> {
  const row = await getEnabledModelOrThrow(modelId);
  const provider = resolveProviderName(row.provider);
  if (!provider) throw new UnknownProviderError(row.provider);
  return provider;
}

function extractAuthStatus(err: unknown): number | null {
  const candidate =
    err && typeof err === 'object'
      ? ((err as { statusCode?: unknown; status?: unknown }).statusCode ??
        (err as { status?: unknown }).status)
      : undefined;
  if (typeof candidate === 'number' && (candidate === 401 || candidate === 403)) {
    return candidate;
  }
  if (err instanceof Error) {
    if (/\b401\b|unauthorized/i.test(err.message)) return 401;
    if (/\b403\b|forbidden/i.test(err.message)) return 403;
  }
  return null;
}

function looksLikeSchemaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'AI_NoObjectGeneratedError' ||
    err.name === 'NoObjectGeneratedError' ||
    /no object generated|invalid object|zod/i.test(err.message)
  );
}
