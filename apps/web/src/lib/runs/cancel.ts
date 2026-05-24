// Cancel an in-flight run (Phase 7). Aborts the in-process executor (if one is
// still registered in this process), then records the terminal state itself so
// the UI reflects the cancel even when the abort can't interrupt a stuck provider
// call. cancel.ts is the SINGLE writer of the cancelled terminal state; the
// executor's `signal.aborted` guards make it stop without overwriting this.
//
// Representation (Phase 7 decision #1): Run.status='failed' +
// failedReason='user_cancelled' + endedAt=now. Running/pending tasks → 'cancelled'
// (done/failed preserved). A 'run.cancelled' RunEvent is appended for the audit
// trail and to push live clients to the terminal state.

import { prisma } from '@db/client';

import { appendEvent } from '@lib/events/append';
import { abortRun } from '@lib/dag/runRegistry';

import { canCancel, cancelTransition } from './cancelState';

export interface CancelResult {
  ok: true;
  runId: string;
  cancelledTasks: number;
  /** Whether an in-process executor controller was found and aborted. */
  aborted: boolean;
}

export interface CancelError {
  error: 'run_not_found' | 'run_not_cancellable';
  status: number;
  runStatus?: string;
}

export function isCancelError(value: CancelResult | CancelError): value is CancelError {
  return 'error' in value;
}

export async function cancelRun(runId: string): Promise<CancelResult | CancelError> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true, status: true },
  });
  if (!run) return { error: 'run_not_found', status: 404 };
  if (!canCancel(run.status)) {
    return { error: 'run_not_cancellable', status: 409, runStatus: run.status };
  }

  // Signal the in-process executor (if still alive in this process) to stop.
  const aborted = abortRun(runId);

  const t = cancelTransition();
  const now = new Date();
  const [, taskUpdate] = await prisma.$transaction([
    prisma.run.update({
      where: { id: runId },
      data: { status: t.runStatus, failedReason: t.failedReason, endedAt: now },
    }),
    prisma.task.updateMany({
      where: { runId, status: { in: [...t.taskStatusesToCancel] } },
      data: { status: t.taskStatus, error: t.failedReason, completedAt: now },
    }),
  ]);

  await appendEvent({
    runId,
    type: 'run.cancelled',
    payload: { failedReason: t.failedReason, cancelledTasks: taskUpdate.count },
  });

  return { ok: true, runId, cancelledTasks: taskUpdate.count, aborted };
}
