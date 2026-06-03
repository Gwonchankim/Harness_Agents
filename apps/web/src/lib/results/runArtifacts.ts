// Phase 15: DB loader for the run's exported artifacts, metadata only. Artifact
// rows are append-only, so this collapses them to the latest per (kind, path)
// via the pure selectLatestArtifacts helper. File content is NEVER read here —
// it is fetched on demand from artifacts/[artifactId]. Kept separate from the
// pure helper so artifactList.ts stays prisma-free (and unit-testable).

import { prisma } from '@db/client';

import {
  groupArtifactHistory,
  selectLatestArtifacts,
  type ArtifactRow,
} from './artifactList';
import { countVersionsByGroup } from './artifactStats';

// Phase 17: defensive upper bounds on artifact row fetches. Both queries sort
// newest-first and take a cap so a pathological run (thousands of re-exports)
// cannot load an unbounded result set. Rows are append-only and the in-memory
// helpers re-sort, so desc+take keeps the newest N — current dev.db tops out at
// 7 versions per (kind, path), far under these caps.
const RUN_ARTIFACTS_MAX = 1000;
const HISTORY_MAX = 200;

export interface ArtifactMeta {
  id: string;
  kind: string;
  path: string;
  bytes: number;
  createdAt: string; // ISO
  // Phase 18 (additive, non-destructive visibility): append-only version stats
  // for this (kind, path) group. versionCount counts all rows; redundantCount =
  // max(0, versionCount - 1). The sha256 breakdown is present only when the
  // group has ≥1 non-null sha256.
  versionCount?: number;
  redundantCount?: number;
  sameContentCount?: number;
  changedVersionCount?: number;
}

export async function loadRunArtifacts(runId: string): Promise<ArtifactMeta[]> {
  const rows = await prisma.artifact.findMany({
    where: { runId },
    orderBy: { createdAt: 'desc' },
    take: RUN_ARTIFACTS_MAX,
    select: { id: true, kind: true, path: true, bytes: true, sha256: true, createdAt: true, taskId: true },
  });
  const mapped: ArtifactRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    path: r.path,
    bytes: r.bytes,
    sha256: r.sha256,
    createdAt: r.createdAt.toISOString(),
    taskId: r.taskId,
  }));
  // Version stats are computed from the SAME rows already fetched above (no
  // extra query); the run loader stays read-only — rows are never mutated.
  const stats = countVersionsByGroup(mapped);
  return selectLatestArtifacts(mapped).map((r) => {
    const s = stats.get(`${r.kind} ${r.path}`);
    return {
      id: r.id,
      kind: r.kind,
      path: r.path,
      bytes: r.bytes,
      createdAt: r.createdAt,
      versionCount: s?.versionCount ?? 1,
      redundantCount: s?.redundantCount ?? 0,
      sameContentCount: s?.sameContentCount,
      changedVersionCount: s?.changedVersionCount,
    };
  });
}

export interface ArtifactVersion {
  id: string;
  bytes: number;
  sha256: string | null;
  createdAt: string; // ISO
  latest: boolean;
}

// Phase 16: append-only creation history for one (kind, path) within a run,
// metadata only — newest first. Past versions are audit records: writers
// overwrite the same disk path, so only the latest version's file still exists
// (file content is never read here). Used by the lazy history toggle.
export async function loadArtifactHistory(
  runId: string,
  kind: string,
  path: string,
): Promise<ArtifactVersion[]> {
  const rows = await prisma.artifact.findMany({
    where: { runId, kind, path },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_MAX,
    select: { id: true, kind: true, path: true, bytes: true, sha256: true, createdAt: true, taskId: true },
  });
  const mapped: ArtifactRow[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    path: r.path,
    bytes: r.bytes,
    sha256: r.sha256,
    createdAt: r.createdAt.toISOString(),
    taskId: r.taskId,
  }));
  const group = groupArtifactHistory(mapped)[0];
  if (!group) return [];
  return group.versions.map((v) => ({
    id: v.id,
    bytes: v.bytes,
    sha256: v.sha256,
    createdAt: v.createdAt,
    latest: v.id === group.latest.id,
  }));
}
