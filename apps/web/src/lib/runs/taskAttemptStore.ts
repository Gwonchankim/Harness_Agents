// DB writes for TaskAttempt (Phase 11). TaskAttempt is the source of truth for
// per-attempt history; Task.result remains the latest-output cache. resultText is
// the full untruncated output (same trust boundary as Task.result) — never logged.

import { prisma } from '@db/client';

import { nextAttemptNumber, type AttemptSource } from './taskAttempt';

/**
 * Open a new attempt (one per runOneTask execution). attemptNumber = max+1 over
 * the task's existing attempts; the `@@unique([taskId, attemptNumber])` constraint
 * surfaces a duplicate loudly (P2002) rather than silently overwriting.
 */
export async function openAttempt(input: {
  runId: string;
  taskId: string;
  source: AttemptSource;
}): Promise<{ id: string; attemptNumber: number }> {
  const existing = await prisma.taskAttempt.findMany({
    where: { taskId: input.taskId },
    select: { attemptNumber: true },
  });
  const attemptNumber = nextAttemptNumber(existing.map((a) => a.attemptNumber));
  return prisma.taskAttempt.create({
    data: {
      runId: input.runId,
      taskId: input.taskId,
      attemptNumber,
      status: 'running',
      source: input.source,
      startedAt: new Date(),
    },
    select: { id: true, attemptNumber: true },
  });
}

export async function closeAttempt(
  id: string,
  input: {
    status: 'done' | 'failed' | 'cancelled';
    resultText?: string | null;
    resultBytes?: number | null;
    error?: string | null;
  },
): Promise<void> {
  // Best-effort: attempt history is observability, not core execution. A close
  // failure (rare transient DB error; this is an update-by-id so it can't hit the
  // attemptNumber unique constraint) must never strand an otherwise-finished
  // task/run. openAttempt stays loud so a duplicate attemptNumber still surfaces.
  try {
    await prisma.taskAttempt.update({
      where: { id },
      data: {
        status: input.status,
        resultText: input.resultText ?? null,
        resultBytes: input.resultBytes ?? null,
        error: input.error ?? null,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    console.error('close_attempt_failed:', err);
  }
}

/** Recovery: close any attempts a dead process left `running` for this run. */
export async function closeOrphanRunningAttempts(runId: string): Promise<void> {
  await prisma.taskAttempt.updateMany({
    where: { runId, status: 'running' },
    data: { status: 'cancelled', error: 'process_restart', completedAt: new Date() },
  });
}
