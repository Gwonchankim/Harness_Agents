// Lead Agent — generates the ExecutionPlan DAG. Reuses the PO/Team error
// classes (PoAuthError / PoSchemaError / ProviderUnavailableError) and the
// Phase 2 timeout helper (`runWithGenerateTimeout` + provider-aware budget).

import { generateObject } from '@lib/agents/runtime';
import {
  getEnabledModelOrThrow,
  resolveProviderName,
  UnknownProviderError,
} from '@lib/models/catalog';

import { resolvePoGenerateTimeoutMs, runWithGenerateTimeout } from '@lib/qa/timeout';
import { topoSort } from '@lib/dag/topo';

import { PoSchemaError, raiseProviderError } from './po';
import {
  buildLeadPlanMessages,
  executionPlanSchema,
  type ExecutionPlanPayload,
  type ExecutionPlanTask,
  type LeadPromptInput,
} from './lead.prompt';

export type { ExecutionPlanPayload, ExecutionPlanTask };

export interface LeadCtx extends LeadPromptInput {
  /** Lead model id — comes from the lead Agent row. */
  modelId: string;
  signal?: AbortSignal;
}

export class LeadPlanInvalidError extends Error {
  constructor(public readonly reason: string) {
    super(`lead_plan_invalid: ${reason}`);
    this.name = 'LeadPlanInvalidError';
  }
}

export async function proposeExecutionPlan(ctx: LeadCtx): Promise<ExecutionPlanPayload> {
  const provider = await resolveProvider(ctx.modelId);
  const messages = buildLeadPlanMessages({
    userPrompt: ctx.userPrompt,
    historyLines: ctx.historyLines,
    teamName: ctx.teamName,
    teamDescription: ctx.teamDescription ?? null,
    agents: ctx.agents,
  });

  let payload: ExecutionPlanPayload;
  try {
    payload = await callLead(provider, ctx.modelId, messages, ctx.signal);
  } catch (err) {
    if (!(err instanceof PoSchemaError)) throw err;
    const repairMessages = buildLeadPlanMessages({
      userPrompt: ctx.userPrompt,
      historyLines: ctx.historyLines,
      teamName: ctx.teamName,
      teamDescription: ctx.teamDescription ?? null,
      agents: ctx.agents,
      strict: true,
    });
    payload = await callLead(provider, ctx.modelId, repairMessages, ctx.signal);
  }
  validatePlanShape(payload, ctx.agents);
  return payload;
}

function validatePlanShape(
  plan: ExecutionPlanPayload,
  agents: LeadPromptInput['agents'],
): void {
  const seenKeys = new Set<string>();
  for (const t of plan.tasks) {
    if (seenKeys.has(t.taskKey)) {
      throw new LeadPlanInvalidError(`duplicate_task_key:${t.taskKey}`);
    }
    seenKeys.add(t.taskKey);
  }
  for (const t of plan.tasks) {
    for (const d of t.dependencies) {
      if (d === t.taskKey) {
        throw new LeadPlanInvalidError(`self_reference:${t.taskKey}`);
      }
    }
  }
  for (const t of plan.tasks) {
    for (const d of t.dependencies) {
      if (!seenKeys.has(d)) {
        throw new LeadPlanInvalidError(`missing_dependency:${t.taskKey}->${d}`);
      }
    }
  }
  const agentMap = new Map<string, LeadPromptInput['agents'][number]>();
  for (const a of agents) {
    if (agentMap.has(a.name)) {
      throw new LeadPlanInvalidError(`ambiguous_agent_name:${a.name}`);
    }
    agentMap.set(a.name, a);
  }
  for (const t of plan.tasks) {
    const ag = agentMap.get(t.assignedAgentName);
    if (!ag) {
      throw new LeadPlanInvalidError(`unknown_assigned_agent:${t.assignedAgentName}`);
    }
    if (ag.isLead) {
      throw new LeadPlanInvalidError(`lead_self_assign:${t.assignedAgentName}`);
    }
  }
  try {
    topoSort(
      plan.tasks.map((t) => ({ taskKey: t.taskKey, dependencies: t.dependencies })),
    );
  } catch (err) {
    throw new LeadPlanInvalidError(err instanceof Error ? err.message : String(err));
  }
}

async function callLead(
  provider: 'openai' | 'anthropic' | 'google' | 'ollama',
  modelId: string,
  messages: ReturnType<typeof buildLeadPlanMessages>,
  signal?: AbortSignal,
): Promise<ExecutionPlanPayload> {
  const timeoutMs = resolvePoGenerateTimeoutMs(provider);
  try {
    const result = await runWithGenerateTimeout(
      signal,
      async (composite) => {
        return generateObject<ExecutionPlanPayload>({
          provider,
          modelId,
          schema: executionPlanSchema,
          messages,
          temperature: 0.4,
          maxTokens: 2048,
          signal: composite,
        });
      },
      timeoutMs,
    );
    return (result as { object: ExecutionPlanPayload }).object;
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
