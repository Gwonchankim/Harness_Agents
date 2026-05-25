import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { ensureRecovered } from '@lib/runtime/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Phase 12: full text of a SINGLE attempt, lazy-fetched on demand (the list
// endpoint returns metadata only). resultText is the full untruncated output
// (same trust boundary as Task.result) — never logged. Validates the full
// run → task → attempt ownership chain.
export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string; taskId: string; attemptId: string }> },
) {
  await ensureRecovered();
  const { runId, taskId, attemptId } = await context.params;
  if (!runId || !taskId || !attemptId) {
    return NextResponse.json({ error: 'params_required' }, { status: 400 });
  }

  // Ownership: the task must belong to this run.
  const task = await prisma.task.findFirst({
    where: { id: taskId, runId },
    select: { id: true },
  });
  if (!task) {
    return NextResponse.json({ error: 'task_not_found' }, { status: 404 });
  }

  // Ownership: the attempt must belong to this task.
  const attempt = await prisma.taskAttempt.findFirst({
    where: { id: attemptId, taskId },
    select: { id: true, attemptNumber: true, status: true, resultText: true, error: true },
  });
  if (!attempt) {
    return NextResponse.json({ error: 'attempt_not_found' }, { status: 404 });
  }

  return NextResponse.json({ attempt });
}
