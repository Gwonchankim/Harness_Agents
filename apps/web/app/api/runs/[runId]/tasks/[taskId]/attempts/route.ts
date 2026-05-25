import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { ensureRecovered } from '@lib/runtime/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Phase 11/12: per-task attempt history (source of truth = TaskAttempt). Fetched
// on demand when a task card's history is expanded. Phase 12: METADATA ONLY —
// resultText is never returned here (lazy-fetched per attempt via the
// attempts/[attemptId] endpoint). `hasResult` lets the UI know which attempts
// have output without reading the full text.
export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string; taskId: string }> },
) {
  await ensureRecovered();
  const { runId, taskId } = await context.params;
  if (!runId || !taskId) {
    return NextResponse.json({ error: 'params_required' }, { status: 400 });
  }

  // Ownership check: the task must belong to this run.
  const task = await prisma.task.findFirst({
    where: { id: taskId, runId },
    select: { id: true },
  });
  if (!task) {
    return NextResponse.json({ error: 'task_not_found' }, { status: 404 });
  }

  const rows = await prisma.taskAttempt.findMany({
    where: { taskId },
    orderBy: { attemptNumber: 'asc' },
    select: {
      id: true,
      attemptNumber: true,
      status: true,
      source: true,
      resultBytes: true,
      error: true,
      startedAt: true,
      completedAt: true,
    },
  });

  // Metadata only. `hasResult` is derived from resultBytes so the full text is
  // never read/returned here; `durationMs` is derived from the timestamps.
  const attempts = rows.map((a) => ({
    id: a.id,
    attemptNumber: a.attemptNumber,
    status: a.status,
    source: a.source,
    resultBytes: a.resultBytes,
    hasResult: a.resultBytes != null,
    startedAt: a.startedAt,
    completedAt: a.completedAt,
    durationMs:
      a.startedAt && a.completedAt
        ? Math.max(0, a.completedAt.getTime() - a.startedAt.getTime())
        : null,
    error: a.error,
  }));

  return NextResponse.json({ attempts });
}
