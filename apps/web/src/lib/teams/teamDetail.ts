// Team detail view assembly for /teams/[teamId]. Keeps the page thin: one call
// returns the active revision (the DB snapshot source of truth for AGENTS.md /
// team.json previews, Phase 6 decision #2), agents with their per-agent rating
// averages, the full revision history (with snapshots for diffing), linked runs,
// and result-rating aggregates. Read-only.

import { prisma } from '@db/client';
import { parseStringArray } from '@lib/db/json';

import { aggregateAgentRatings, averageOf } from './ratings';

export interface TeamDetailAgent {
  id: string;
  name: string;
  role: string;
  isLead: boolean;
  modelId: string;
  provider: string;
  toolsAllowed: string[];
  tags: string[];
  ratingAvg: number | null;
  ratingCount: number;
}

export interface TeamDetailRevision {
  id: string;
  version: number;
  proposedBy: string;
  approvedBy: string | null;
  reason: string | null;
  sourceRunId: string | null;
  createdAt: Date;
  approvedAt: Date | null;
  agentsMd: string;
  teamJson: string;
}

export interface TeamDetailRun {
  id: string;
  prompt: string;
  status: string;
  failedReason: string | null;
  createdAt: Date;
}

export interface TeamDetailView {
  id: string;
  name: string;
  description: string | null;
  domain: string | null;
  tags: string[];
  status: string;
  score: number | null;
  currentRevisionId: string | null;
  currentVersion: number | null;
  /** From the current revision — the DB snapshot used for in-app previews. */
  agentsMd: string | null;
  teamJson: string | null;
  agents: TeamDetailAgent[];
  revisions: TeamDetailRevision[];
  runs: TeamDetailRun[];
  resultRatingAvg: number | null;
  resultRatingCount: number;
}

export async function loadTeamDetail(teamId: string): Promise<TeamDetailView | null> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      name: true,
      description: true,
      domain: true,
      tags: true,
      status: true,
      score: true,
      currentRevisionId: true,
      currentRevision: { select: { version: true, agentsMd: true, teamJson: true } },
      agents: {
        select: {
          id: true,
          name: true,
          role: true,
          isLead: true,
          modelId: true,
          provider: true,
          toolsAllowed: true,
          tags: true,
          createdAt: true,
        },
        orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
      },
      revisions: {
        select: {
          id: true,
          version: true,
          proposedBy: true,
          approvedBy: true,
          reason: true,
          sourceRunId: true,
          createdAt: true,
          approvedAt: true,
          agentsMd: true,
          teamJson: true,
        },
        orderBy: { version: 'desc' },
      },
      runs: {
        select: { id: true, prompt: true, status: true, failedReason: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
    },
  });
  if (!team) return null;

  const [agentRatings, resultBatches] = await Promise.all([
    prisma.agentRating.findMany({
      where: { agent: { teamId } },
      select: { agentId: true, rating: true },
    }),
    prisma.feedbackBatch.findMany({
      where: { run: { teamId }, resultRating: { not: null } },
      select: { resultRating: true },
    }),
  ]);

  const byAgent = aggregateAgentRatings(agentRatings);
  const resultValues = resultBatches
    .map((b) => b.resultRating)
    .filter((v): v is number => v != null);

  return {
    id: team.id,
    name: team.name,
    description: team.description,
    domain: team.domain,
    tags: parseStringArray(team.tags),
    status: team.status,
    score: team.score,
    currentRevisionId: team.currentRevisionId,
    currentVersion: team.currentRevision?.version ?? null,
    agentsMd: team.currentRevision?.agentsMd ?? null,
    teamJson: team.currentRevision?.teamJson ?? null,
    agents: team.agents.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      isLead: a.isLead,
      modelId: a.modelId,
      provider: a.provider,
      toolsAllowed: parseStringArray(a.toolsAllowed),
      tags: parseStringArray(a.tags),
      ratingAvg: byAgent.get(a.id)?.avg ?? null,
      ratingCount: byAgent.get(a.id)?.count ?? 0,
    })),
    revisions: team.revisions.map((r) => ({
      id: r.id,
      version: r.version,
      proposedBy: r.proposedBy,
      approvedBy: r.approvedBy,
      reason: r.reason,
      sourceRunId: r.sourceRunId,
      createdAt: r.createdAt,
      approvedAt: r.approvedAt,
      agentsMd: r.agentsMd,
      teamJson: r.teamJson,
    })),
    runs: team.runs,
    resultRatingAvg: averageOf(resultValues),
    resultRatingCount: resultValues.length,
  };
}
