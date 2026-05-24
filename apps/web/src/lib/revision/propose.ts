// Revision propose orchestrator. Loads the run + its latest feedback batch, asks
// the Lead for an improved team, validates it against the current roster, builds
// before/after snapshots + a diff, and emits revision.proposed. Does NOT create a
// TeamRevision — that happens only on approve. The proposed spec is returned to
// the client and re-sent (and re-validated) on approve.

import { prisma } from '@db/client';
import { parseJson, parseStringArray } from '@lib/db/json';

import { proposeTeamImprovement } from '@lib/agents/leadRevise';
import { appendEvent } from '@lib/events/append';
import {
  countDiff,
  diffLines,
  summarizeTeamChanges,
  type DiffLine,
  type DiffTeamSpec,
  type TeamChangeSummary,
} from '@lib/feedback/diff';
import { loadRunResultMarkdown } from '@lib/results/finalResult';
import { buildSnapshot, type SerializableAgent } from '@lib/team/serialize';

import { validateRevisionProposal, type ProposedRevisionSpec } from './validate';

const RESULT_EXCERPT_MAX = 3000;
const AGENT_OUTPUT_EXCERPT_MAX = 800;

export class RevisionContextError extends Error {
  constructor(public readonly reason: string) {
    super(`revision_context_error: ${reason}`);
    this.name = 'RevisionContextError';
  }
}

export interface ProposeRevisionResult {
  baseRevisionId: string;
  feedbackBatchId: string;
  rationale: string;
  diff: DiffLine[];
  counts: { added: number; removed: number };
  summary: TeamChangeSummary;
  currentAgentsMd: string;
  proposedAgentsMd: string;
  proposedSpec: ProposedRevisionSpec;
}

export async function proposeRevision(runId: string): Promise<ProposeRevisionResult> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      prompt: true,
      status: true,
      team: {
        select: {
          id: true,
          name: true,
          description: true,
          domain: true,
          tags: true,
          currentRevisionId: true,
          agents: {
            select: {
              id: true,
              name: true,
              role: true,
              isLead: true,
              systemPrompt: true,
              modelId: true,
              provider: true,
              toolsAllowed: true,
              tags: true,
              createdAt: true,
            },
            orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
      tasks: { select: { agentId: true, result: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  if (!run || !run.team) throw new RevisionContextError('run_has_no_team');
  if (run.status !== 'succeeded') throw new RevisionContextError('run_not_succeeded');

  const team = run.team;
  const lead = team.agents.find((a) => a.isLead);
  if (!lead) throw new RevisionContextError('team_has_no_lead');
  if (!team.currentRevisionId) throw new RevisionContextError('team_has_no_revision');

  const batch = await prisma.feedbackBatch.findFirst({
    where: { runId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      resultRating: true,
      resultComment: true,
      ratings: { select: { agentId: true, rating: true, comment: true } },
    },
  });
  if (!batch) throw new RevisionContextError('feedback_required');

  const teamMeta = {
    name: team.name,
    description: team.description,
    domain: team.domain,
    tags: parseStringArray(team.tags),
  };
  const currentAgents: SerializableAgent[] = team.agents.map((a) => ({
    name: a.name,
    role: a.role,
    isLead: a.isLead,
    modelId: a.modelId,
    provider: a.provider,
    systemPrompt: a.systemPrompt,
    toolsAllowed: parseStringArray(a.toolsAllowed),
    tags: parseStringArray(a.tags),
  }));
  const currentSnapshot = buildSnapshot(teamMeta, currentAgents);

  const outputsByAgent = new Map<string, string>();
  for (const t of run.tasks) {
    if (!t.agentId || !t.result) continue;
    const parsed = parseJson<{ text?: string }>(t.result, {});
    if (!parsed.text) continue;
    const prev = outputsByAgent.get(t.agentId);
    outputsByAgent.set(t.agentId, prev ? `${prev}\n${parsed.text}` : parsed.text);
  }

  const resultMd = (await loadRunResultMarkdown(runId)) ?? '';

  const proposal = await proposeTeamImprovement({
    modelId: lead.modelId,
    teamName: team.name,
    teamDescription: team.description,
    userPrompt: run.prompt,
    resultExcerpt: resultMd.slice(0, RESULT_EXCERPT_MAX),
    resultRating: batch.resultRating,
    resultComment: batch.resultComment,
    currentAgents: team.agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      role: a.role,
      isLead: a.isLead,
      systemPrompt: a.systemPrompt,
      toolsAllowed: parseStringArray(a.toolsAllowed),
      tags: parseStringArray(a.tags),
      outputExcerpt: (outputsByAgent.get(a.id) ?? '').slice(0, AGENT_OUTPUT_EXCERPT_MAX),
    })),
    agentFeedback: batch.ratings.map((r) => ({
      agentId: r.agentId,
      name: team.agents.find((a) => a.id === r.agentId)?.name ?? 'unknown',
      rating: r.rating,
      comment: r.comment,
    })),
  });

  const spec = validateRevisionProposal(
    proposal,
    team.agents.map((a) => a.id),
  );

  const existingById = new Map(team.agents.map((a) => [a.id, a] as const));
  const afterAgents: SerializableAgent[] = spec.agents.map((pa) => {
    const existing = existingById.get(pa.agentId)!;
    return {
      name: pa.name,
      role: pa.role,
      isLead: pa.isLead,
      modelId: existing.modelId,
      provider: existing.provider,
      systemPrompt: pa.systemPrompt,
      toolsAllowed: pa.toolsAllowed,
      tags: pa.tags,
    };
  });
  const afterMeta = { ...teamMeta, description: spec.teamDescription ?? teamMeta.description };
  const proposedSnapshot = buildSnapshot(afterMeta, afterAgents);

  const diff = diffLines(currentSnapshot.agentsMd, proposedSnapshot.agentsMd);
  const counts = countDiff(diff);

  const beforeSpec: DiffTeamSpec = {
    name: teamMeta.name,
    description: teamMeta.description ?? null,
    agents: team.agents.map((a) => ({
      agentId: a.id,
      name: a.name,
      isLead: a.isLead,
      role: a.role,
      systemPrompt: a.systemPrompt,
      toolsAllowed: parseStringArray(a.toolsAllowed),
      tags: parseStringArray(a.tags),
    })),
  };
  const afterSpec: DiffTeamSpec = {
    name: afterMeta.name,
    description: afterMeta.description ?? null,
    agents: spec.agents.map((pa) => ({
      agentId: pa.agentId,
      name: pa.name,
      isLead: pa.isLead,
      role: pa.role,
      systemPrompt: pa.systemPrompt,
      toolsAllowed: pa.toolsAllowed,
      tags: pa.tags,
    })),
  };
  const summary = summarizeTeamChanges(beforeSpec, afterSpec);

  await appendEvent({
    runId,
    type: 'revision.proposed',
    payload: {
      baseRevisionId: team.currentRevisionId,
      changedAgents: summary.changedAgents.length,
      added: counts.added,
      removed: counts.removed,
      reason: spec.rationale.slice(0, 200),
    },
  });

  return {
    baseRevisionId: team.currentRevisionId,
    feedbackBatchId: batch.id,
    rationale: spec.rationale,
    diff,
    counts,
    summary,
    currentAgentsMd: currentSnapshot.agentsMd,
    proposedAgentsMd: proposedSnapshot.agentsMd,
    proposedSpec: spec,
  };
}
