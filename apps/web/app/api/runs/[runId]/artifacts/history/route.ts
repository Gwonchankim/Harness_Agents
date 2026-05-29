import { NextResponse } from 'next/server';

import { loadArtifactHistory } from '@lib/results/runArtifacts';
import { ensureRecovered } from '@lib/runtime/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Phase 16: lazy, metadata-only creation history for one (kind, path) of a run.
// The exports panel fetches this only when a row's history toggle is opened, so
// the state/page payload stays latest-only. Returns every append-only version
// (newest first) with createdAt/bytes/sha256/id/latest — no file content. Past
// versions are audit records: the disk file is overwritten per export, so only
// the latest version's content is recoverable (the UI states this).
export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  await ensureRecovered();
  const { runId } = await context.params;
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const path = url.searchParams.get('path');
  if (!runId || !kind || !path) {
    return NextResponse.json({ error: 'params_required' }, { status: 400 });
  }

  const versions = await loadArtifactHistory(runId, kind, path);
  return NextResponse.json({ versions });
}
