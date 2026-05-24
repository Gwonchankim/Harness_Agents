// Prepare a failed/cancelled run for in-place partial resume (Phase 8). The third
// retry strategy alongside lib/runs/retry.ts (reset / clone): instead of starting
// over, reset the failed/cancelled tasks to `pending` (keeping done tasks and
// their results), flip the run back to `running`, and emit `run.resumed`. The
// /resume (and task-retry) route then fires `executeResume`, which skips planning
// and runs only the not-done tasks. Schema-free: reuses existing free-form status
// columns + a new free-form RunEvent type.

import { prisma } from '@db/client';

import { appendEvent } from '@lib/events/append';

import { computeResumePlan, type ResumeMode } from './resumePlan';

export interface ResumeResult {
  ok: true;
  runId: string;
  mode: ResumeMode['kind'];
  resetTasks: number;
  doneReused: number;
}

export interface ResumeError {
  error:
    | 'run_not_found'
    | 'run_not_resumable'
    | 'no_plan'
    | 'no_reusable_done_tasks'
    | 'no_resumable_tasks'
    | 'target_not_found'
    | 'task_not_retryable';
  status: number;
  runStatus?: string;
}

export function isResumeError(value: ResumeResult | ResumeError): value is ResumeError {
  return 'error' in value;
}

/**
 * Validate + reset tasks for resume. Does NOT run the executor — the route owns
 * firing `executeResume` (with an AbortController) after this resolves ok.
 */
export async function prepareResume(
  runId: string,
  mode: ResumeMode,
): Promise<ResumeResult | ResumeError> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      plan: { select: { id: true } },
      tasks: { select: { taskKey: true, status: true } },
    },
  });
  if (!run) return { error: 'run_not_found', status: 404 };
  if (run.status !== 'failed') {
    return { error: 'run_not_resumable', status: 409, runStatus: run.status };
  }

  const plan = computeResumePlan({
    planExists: run.plan != null,
    tasks: run.tasks,
    mode,
  });
  if (!plan.eligible) {
    const reason = plan.reason ?? 'no_resumable_tasks';
    const status = reason === 'target_not_found' ? 404 : 409;
    return { error: reason, status };
  }

  await prisma.$transaction([
    prisma.task.updateMany({
      where: { runId, taskKey: { in: plan.resetKeys } },
      data: { status: 'pending', error: null, result: null, startedAt: null, completedAt: null },
    }),
    prisma.run.update({
      where: { id: runId },
      data: { status: 'running', failedReason: null, endedAt: null },
    }),
  ]);

  await appendEvent({
    runId,
    type: 'run.resumed',
    payload: {
      mode: mode.kind,
      resumedTasks: plan.resetKeys.length,
      doneReused: plan.doneCount,
      ...(mode.kind === 'fromTask' ? { fromTaskKey: mode.targetKey } : {}),
    },
  });

  return {
    ok: true,
    runId,
    mode: mode.kind,
    resetTasks: plan.resetKeys.length,
    doneReused: plan.doneCount,
  };
}
