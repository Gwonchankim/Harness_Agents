import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { selectCleanupCandidates, buildLinkAudit } from '@lib/results/artifactLinkAudit';
import type { ArtifactRow } from '@lib/results/artifactList';
import { ensureRecovered } from '@lib/runtime/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bound on the artifact rows scanned per run (matches loadRunArtifacts).
const RUN_ARTIFACTS_MAX = 1000;

// Phase 20: read-only dry-run cleanup AUDIT. Reports — authoritatively, from the
// full DB (not just loaded/visible events) — how many older (non-latest) metadata
// rows a future keep-latest cleanup would drop per (kind, path), and how many
// RunEvent links would be set to NULL. ONLY result.created events carry an
// artifactId, so non-result kinds report 0 linked events.
//
// STRICTLY READ-ONLY: findMany + groupBy only. No create/update/delete/upsert.
// Nothing is cleaned here (Phase 21+ would perform any actual deletion).
export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  await ensureRecovered();
  const { runId } = await context.params;
  if (!runId) {
    return NextResponse.json({ error: 'params_required' }, { status: 400 });
  }

  // Latest-per-(kind,path) selection + non-latest candidate ids, from this run's
  // artifact rows (read-only). Unknown/empty run → empty candidates → zeros.
  const rows = await prisma.artifact.findMany({
    where: { runId },
    orderBy: { createdAt: 'desc' },
    take: RUN_ARTIFACTS_MAX,
    select: { id: true, kind: true, path: true, createdAt: true },
  });
  const mapped: ArtifactRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    path: r.path,
    bytes: 0, // unused by candidate selection (grouping + newest-first sort only)
    sha256: null, // unused
    createdAt: r.createdAt.toISOString(),
    taskId: null, // unused
  }));
  const { groups, allCandidateIds } = selectCleanupCandidates(mapped);

  // Authoritative full-DB RunEvent link count per candidate artifact. Skip the
  // query entirely when there are no candidates (avoids an empty `in` clause).
  const linkCountByArtifactId = new Map<string, number>();
  if (allCandidateIds.length > 0) {
    const grouped = await prisma.runEvent.groupBy({
      by: ['artifactId'],
      where: { runId, type: 'result.created', artifactId: { in: allCandidateIds } },
      _count: { _all: true },
    });
    for (const g of grouped) {
      if (g.artifactId) linkCountByArtifactId.set(g.artifactId, g._count._all);
    }
  }

  const audit = buildLinkAudit(groups, linkCountByArtifactId);
  // Count-centric response: candidateIds stay internal to the helper (Phase 21
  // reuse / tests), not exposed here.
  return NextResponse.json({
    summary: audit.summary,
    groups: audit.groups.map((g) => ({
      kind: g.kind,
      path: g.path,
      candidateCount: g.candidateCount,
      linkedEventsAffected: g.linkedEventsAffected,
    })),
  });
}
