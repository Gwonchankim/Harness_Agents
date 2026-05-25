import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { ensureRecovered } from '@lib/runtime/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Phase 11: per-task attempt history (source of truth = TaskAttempt). Fetched
// on demand when a task card's history is expanded — resultText is included
// inline, so the run list / full run load must NOT call this endpoint.
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

  const attempts = await prisma.taskAttempt.findMany({
    where: { taskId },
    orderBy: { attemptNumber: 'asc' },
    select: {
      id: true,
      attemptNumber: true,
      status: true,
      source: true,
      resultText: true,
      resultBytes: true,
      error: true,
      startedAt: true,
      completedAt: true,
    },
  });

  return NextResponse.json({ attempts });
}
