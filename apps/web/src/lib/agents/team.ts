// Team Architect agent — wraps runtime.generateObject for the team proposal,
// then maps each agent's modelHint to a concrete enabled ModelCatalog.modelId
// server-side. The LLM never picks exact model IDs.

import { generateObject } from '@lib/agents/runtime';
import {
  getEnabledModelOrThrow,
  resolveProviderName,
  UnknownProviderError,
} from '@lib/models/catalog';

import { resolvePoGenerateTimeoutMs, runWithGenerateTimeout } from '@lib/qa/timeout';

import { PoSchemaError, raiseProviderError } from './po';
import {
  buildTeamProposalMessages,
  teamProposalSchema,
  TEAM_AGENT_COUNT,
  type ModelHint,
  type ProposedAgent,
  type TeamProposalPayload,
} from './team.prompt';

export type { ProposedAgent, TeamProposalPayload, ModelHint };
export { TEAM_AGENT_COUNT };

export interface TeamCtx {
  /** PO model id from Run.poModelId — same model that drove Q&A. */
  modelId: string;
  userPrompt: string;
  historyLines: string[];
  signal?: AbortSignal;
}

export interface ResolvedAgent extends ProposedAgent {
  /** Server-resolved final modelId from the catalog. */
  modelId: string;
  /** Server-resolved provider for that modelId. */
  provider: 'openai' | 'anthropic' | 'google' | 'ollama';
}

export interface ResolvedTeamProposal {
  name: string;
  description?: string;
  domain?: string;
  tags: string[];
  agents: ResolvedAgent[];
}

/**
 * Generate a team proposal from the user's prompt + Q&A history. Throws
 * Phase-2-style errors that the route maps to HTTP statuses.
 *
 * On PoSchemaError we automatically retry once with a stricter repair prompt —
 * local Gemma-family models sometimes drop schema constraints on the first try,
 * and a single repair attempt recovers most of those cases without surfacing
 * the error to the user.
 */
export async function proposeNewTeam(ctx: TeamCtx): Promise<TeamProposalPayload> {
  const provider = await resolveAndCheckProvider(ctx.modelId);
  const firstMessages = buildTeamProposalMessages({
    userPrompt: ctx.userPrompt,
    historyLines: ctx.historyLines,
  });
  try {
    return await callGenerate(provider, ctx.modelId, firstMessages, ctx.signal);
  } catch (err) {
    if (!(err instanceof PoSchemaError)) throw err;
    const repairMessages = buildTeamProposalMessages({
      userPrompt: ctx.userPrompt,
      historyLines: ctx.historyLines,
      strict: true,
    });
    return callGenerate(provider, ctx.modelId, repairMessages, ctx.signal);
  }
}

async function callGenerate(
  provider: 'openai' | 'anthropic' | 'google' | 'ollama',
  modelId: string,
  messages: ReturnType<typeof buildTeamProposalMessages>,
  signal?: AbortSignal,
): Promise<TeamProposalPayload> {
  const timeoutMs = resolvePoGenerateTimeoutMs(provider);
  try {
    const result = await runWithGenerateTimeout(
      signal,
      async (composite) => {
        return generateObject<TeamProposalPayload>({
          provider,
          modelId,
          schema: teamProposalSchema,
          messages,
          temperature: 0.5,
          maxTokens: 2048,
          signal: composite,
        });
      },
      timeoutMs,
    );
    return (result as { object: TeamProposalPayload }).object;
  } catch (err) {
    raiseProviderError(err, { provider, modelId });
  }
}

async function resolveAndCheckProvider(
  modelId: string,
): Promise<'openai' | 'anthropic' | 'google' | 'ollama'> {
  const row = await getEnabledModelOrThrow(modelId);
  const provider = resolveProviderName(row.provider);
  if (!provider) throw new UnknownProviderError(row.provider);
  return provider;
}

// ----------------------------------------------------------------------------
// Server-side modelHint resolution
// ----------------------------------------------------------------------------

export interface CatalogModelRow {
  modelId: string;
  provider: string;
  costTier: string;
  speedTier: string;
  enabled: boolean;
  isDefault: boolean;
}

/**
 * Map each agent's modelHint to a concrete enabled modelId. Falls back to the
 * fallbackModelId (Run.poModelId) if no row matches the hint. The LLM never
 * gets to invent model IDs — this function owns the mapping.
 */
export function resolveModelHints(
  proposal: TeamProposalPayload,
  enabled: readonly CatalogModelRow[],
  fallbackModelId: string,
): ResolvedTeamProposal {
  if (enabled.length === 0) {
    throw new Error('resolve_model_hints: no enabled models in catalog');
  }
  const fallback = enabled.find((m) => m.modelId === fallbackModelId) ?? enabled[0]!;
  const agents: ResolvedAgent[] = proposal.agents.map((a) => {
    const picked = pickModelForHint(a.modelHint, enabled) ?? fallback;
    const provider = resolveProviderName(picked.provider);
    if (!provider) {
      throw new UnknownProviderError(picked.provider);
    }
    return {
      ...a,
      modelId: picked.modelId,
      provider,
    };
  });
  return {
    name: proposal.name,
    description: proposal.description,
    domain: proposal.domain,
    tags: proposal.tags,
    agents,
  };
}

function pickModelForHint(
  hint: ModelHint,
  enabled: readonly CatalogModelRow[],
): CatalogModelRow | undefined {
  switch (hint) {
    case 'fast':
      return (
        enabled.find((m) => m.speedTier === 'fast' && m.costTier === 'low') ??
        enabled.find((m) => m.speedTier === 'fast' && m.costTier === 'free') ??
        enabled.find((m) => m.speedTier === 'fast')
      );
    case 'standard':
      return (
        enabled.find((m) => m.costTier === 'standard') ??
        enabled.find((m) => m.isDefault) ??
        enabled.find((m) => m.speedTier === 'fast')
      );
    case 'premium':
      return (
        enabled.find((m) => m.costTier === 'premium') ??
        enabled.find((m) => m.costTier === 'standard')
      );
    case 'local':
      return enabled.find((m) => m.provider === 'ollama');
  }
}
