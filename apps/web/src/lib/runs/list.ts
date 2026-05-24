// Run-list query for the /runs browse page. Thin Prisma wrapper so the page stays
// presentational. Status filter is an exact Run.status match; `q` is an
// (ASCII-case-insensitive on SQLite) substring match on the prompt.

import type { Prisma } from '@prisma/client';

import { prisma } from '@db/client';

export interface RunListItem {
  id: string;
  prompt: string;
  status: string;
  failedReason: string | null;
  updatedAt: Date;
  projectName: string;
  teamId: string | null;
  teamName: string | null;
  qaSession: { id: string; status: string } | null;
}

export interface RunListFilter {
  status?: string | null;
  q?: string | null;
  take?: number;
}

/** Status values offered by the filter bar. 'all' clears the status filter. */
export const RUN_STATUS_FILTERS = [
  'all',
  'po_qa',
  'ready',
  'planning',
  'running',
  'succeeded',
  'failed',
] as const;

export type RunStatusFilter = (typeof RUN_STATUS_FILTERS)[number];

export function normalizeStatusFilter(raw: string | null | undefined): RunStatusFilter {
  return (RUN_STATUS_FILTERS as readonly string[]).includes(raw ?? '')
    ? (raw as RunStatusFilter)
    : 'all';
}

export async function listRuns(filter: RunListFilter = {}): Promise<RunListItem[]> {
  const where: Prisma.RunWhereInput = {};
  if (filter.status && filter.status !== 'all') {
    where.status = filter.status;
  }
  const q = filter.q?.trim();
  if (q) {
    where.prompt = { contains: q };
  }

  const rows = await prisma.run.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    take: filter.take ?? 50,
    select: {
      id: true,
      prompt: true,
      status: true,
      failedReason: true,
      updatedAt: true,
      teamId: true,
      project: { select: { name: true } },
      team: { select: { name: true } },
      qaSession: { select: { id: true, status: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    status: r.status,
    failedReason: r.failedReason,
    updatedAt: r.updatedAt,
    projectName: r.project.name,
    teamId: r.teamId,
    teamName: r.team?.name ?? null,
    qaSession: r.qaSession,
  }));
}
