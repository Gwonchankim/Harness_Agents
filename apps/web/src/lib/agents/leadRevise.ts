// Lead revision call — wraps runtime.generateObject for the team-improvement
// proposal. Reuses the PO/Team error classes + the Phase 2 timeout, exactly like
// lead.ts / team.ts. Never persists anything; callers own DB writes.

import { generateObject } from '@lib/agents/runtime';
import {
  getEnabledModelOrThrow,
  resolveProviderName,
  UnknownProviderError,
} from '@lib/models/catalog';

import { resolvePoGenerateTimeoutMs, runWithGenerateTimeout } from '@lib/qa/timeout';

import { PoSchemaError, raiseProviderError } from './po';
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
    raiseProviderError(err, { provider, modelId });
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
