import { readFile } from 'node:fs/promises';

import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { ensureRecovered } from '@lib/runtime/recovery';
import { truncateForPreview } from '@lib/runs/attemptView';
import { safeJoin, workspaceRoot } from '@lib/workspace/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cap how much of a large export the preview returns. The full file stays on
// disk (source of truth); this only bounds the on-demand UI payload.
const MAX_PREVIEW_CHARS = 200_000;

// Phase 15: lazy text preview of a SINGLE exported artifact (result.md /
// report.md / agent-reports/*). The state/page endpoints carry metadata only;
// file content is read here on demand. The stored path is validated through
// safeJoin (must resolve inside the workspace root), and a row whose file is
// missing on disk degrades to { missing: true } rather than erroring.
export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string; artifactId: string }> },
) {
  await ensureRecovered();
  const { runId, artifactId } = await context.params;
  if (!runId || !artifactId) {
    return NextResponse.json({ error: 'params_required' }, { status: 400 });
  }

  // Ownership: the artifact must belong to this run.
  const artifact = await prisma.artifact.findFirst({
    where: { id: artifactId, runId },
    select: { kind: true, path: true, bytes: true, createdAt: true },
  });
  if (!artifact) {
    return NextResponse.json({ error: 'artifact_not_found' }, { status: 404 });
  }

  const meta = {
    kind: artifact.kind,
    path: artifact.path,
    bytes: artifact.bytes,
    createdAt: artifact.createdAt.toISOString(),
  };

  let raw: string;
  try {
    raw = await readFile(safeJoin(workspaceRoot(), artifact.path), 'utf8');
  } catch {
    // DB row exists but the file is gone/unreadable (or the path is unsafe) —
    // degrade gracefully instead of 500.
    return NextResponse.json({ artifact: meta, missing: true });
  }

  const { preview, truncated, totalChars } = truncateForPreview(raw, MAX_PREVIEW_CHARS);
  return NextResponse.json({ artifact: meta, content: preview, truncated, totalChars });
}
