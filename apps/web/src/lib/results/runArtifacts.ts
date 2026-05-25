// Phase 15: DB loader for the run's exported artifacts, metadata only. Artifact
// rows are append-only, so this collapses them to the latest per (kind, path)
// via the pure selectLatestArtifacts helper. File content is NEVER read here —
// it is fetched on demand from artifacts/[artifactId]. Kept separate from the
// pure helper so artifactList.ts stays prisma-free (and unit-testable).

import { prisma } from '@db/client';

import { selectLatestArtifacts, type ArtifactRow } from './artifactList';

export interface ArtifactMeta {
  id: string;
  kind: string;
  path: string;
  bytes: number;
  createdAt: string; // ISO
}

export async function loadRunArtifacts(runId: string): Promise<ArtifactMeta[]> {
  const rows = await prisma.artifact.findMany({
    where: { runId },
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
  return selectLatestArtifacts(mapped).map((r) => ({
    id: r.id,
    kind: r.kind,
    path: r.path,
    bytes: r.bytes,
    createdAt: r.createdAt,
  }));
}
