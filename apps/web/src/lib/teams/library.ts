// Team Library query for /teams. Lists active teams with derived counts. When a
// search query is present, ranks with the existing pure scorer from teamSearch;
// otherwise sorts by the requested key. Linked-run count is derived from the
// Run relation (Team.runCount is not maintained, so it is never used here).

import { prisma } from '@db/client';
import { parseStringArray } from '@lib/db/json';
import { scoreTeams, type RankableTeam } from '@lib/search/teamSearch';

export interface TeamLibraryItem {
  id: string;
  name: string;
  description: string | null;
  domain: string | null;
  tags: string[];
  status: string;
  score: number | null;
  leadAgentName: string | null;
  agentCount: number;
  runCount: number;
  currentVersion: number | null;
  updatedAt: Date;
}

export type TeamSort = 'recent' | 'score' | 'name';

export const TEAM_SORTS = ['recent', 'score', 'name'] as const;

export function normalizeSort(raw: string | null | undefined): TeamSort {
  return (TEAM_SORTS as readonly string[]).includes(raw ?? '') ? (raw as TeamSort) : 'recent';
}

export function matchesTeamQuery(team: {
  name: string;
  description: string | null;
  domain: string | null;
  tags: readonly string[];
}, rawQuery: string | null | undefined): boolean {
  const tokens = rawQuery
    ?.trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens || tokens.length === 0) return true;

  const haystack = [
    team.name,
    team.description ?? '',
    team.domain ?? '',
    ...team.tags,
  ]
    .join(' ')
    .toLocaleLowerCase();

  return tokens.every((token) => haystack.includes(token));
}

export async function listTeams(
  opts: { q?: string | null; sort?: TeamSort } = {},
): Promise<TeamLibraryItem[]> {
  const teams = await prisma.team.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      name: true,
      description: true,
      domain: true,
      tags: true,
      status: true,
      score: true,
      updatedAt: true,
      leadAgent: { select: { name: true } },
      currentRevision: { select: { version: true } },
      _count: { select: { agents: true, runs: true } },
    },
  });

  const items: TeamLibraryItem[] = teams.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    domain: t.domain,
    tags: parseStringArray(t.tags),
    status: t.status,
    score: t.score,
    leadAgentName: t.leadAgent?.name ?? null,
    agentCount: t._count.agents,
    runCount: t._count.runs,
    currentVersion: t.currentRevision?.version ?? null,
    updatedAt: t.updatedAt,
  }));

  const q = opts.q?.trim();
  if (q) {
    const matchingItems = items.filter((item) => matchesTeamQuery(item, q));
    if (matchingItems.length === 0) return [];

    const ranked = scoreTeams(
      { prompt: q, historyLines: [] },
      matchingItems.map<RankableTeam>((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        domain: t.domain,
        tags: t.tags,
        score: t.score,
        leadAgentName: t.leadAgentName,
        agentCount: t.agentCount,
      })),
      matchingItems.length,
    );
    const order = new Map(ranked.map((r, i) => [r.teamId, i] as const));
    return [...matchingItems].sort(
      (a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity),
    );
  }

  const sort = opts.sort ?? 'recent';
  return [...items].sort((a, b) => {
    if (sort === 'score') return (b.score ?? -1) - (a.score ?? -1);
    if (sort === 'name') return a.name.localeCompare(b.name);
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });
}
