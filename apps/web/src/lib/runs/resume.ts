// Prepare a run for in-place resume / re-run (Phase 8 + Phase 9). Strategies:
//   - 'auto'          run-level resume of a failed run (reset all failed/cancelled).
//   - 'fromTask'      task-level retry of a failed/cancelled task.
//   - 'rerunFromTask' (Phase 9) re-run a done/failed/cancelled task + its transitive
//                     downstream on a TERMINAL run (failed or succeeded). Done tasks
//                     not reset keep their results and are reused as upstream context.
//
// Always: reset the chosen tasks to `pending` (wiping their result), flip the run to
// `running`, emit a `task.reset` audit event per reset task (carrying the previous
// status/bytes — prior full output remains reconstructable from append-only
// agent.output.delta events), then `run.resumed`. The route fires `executeResume`.
// Schema-free: existing free-form status columns + new free-form RunEvent types.

import { prisma } from '@db/client';
import { parseJson } from '@lib/db/json';

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
    | 'task_not_retryable'
    | 'task_not_rerunnable';
  status: number;
  runStatus?: string;
}

export function isResumeError(value: ResumeResult | ResumeError): value is ResumeError {
  return 'error' in value;
}

/** Run states from which a `rerunFromTask` (Phase 9) is allowed. */
function rerunAllowed(status: string): boolean {
  return status === 'failed' || status === 'succeeded';
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
      tasks: {
        select: { id: true, taskKey: true, status: true, dependencies: true, result: true },
      },
    },
  });
  if (!run) return { error: 'run_not_found', status: 404 };

  // Phase 9: rerunFromTask works on terminal runs (failed | succeeded). The Phase 8
  // strategies (auto / fromTask) remain restricted to failed runs.
  const statusOk =
    mode.kind === 'rerunFromTask' ? rerunAllowed(run.status) : run.status === 'failed';
  if (!statusOk) {
    return { error: 'run_not_resumable', status: 409, runStatus: run.status };
  }

  const taskInputs = run.tasks.map((t) => ({
    taskKey: t.taskKey,
    status: t.status,
    dependencies: parseJson<string[]>(t.dependencies, []),
  }));

  const plan = computeResumePlan({ planExists: run.plan != null, tasks: taskInputs, mode });
  if (!plan.eligible) {
    const reason = plan.reason ?? 'no_resumable_tasks';
    const status = reason === 'target_not_found' ? 404 : 409;
    return { error: reason, status };
  }

  // Capture prior state for the audit trail before it is wiped.
  const resetSet = new Set(plan.resetKeys);
  const resetRows = run.tasks.filter((t) => resetSet.has(t.taskKey));
  const resetReason = mode.kind === 'rerunFromTask' ? 'rerun_from_task' : 'resume';
  const resetByTaskKey = 'targetKey' in mode ? mode.targetKey : undefined;

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

  // Audit each reset task (especially done ones whose result was overwritten).
  for (const row of resetRows) {
    const previousResult = row.result
      ? parseJson<{ bytes?: number; text?: string }>(row.result, {})
      : {};
    const previousBytes =
      previousResult.bytes ??
      (typeof previousResult.text === 'string'
        ? Buffer.byteLength(previousResult.text, 'utf8')
        : null);
    await appendEvent({
      runId,
      taskId: row.id,
      type: 'task.reset',
      payload: {
        taskKey: row.taskKey,
        previousStatus: row.status,
        previousBytes,
        reason: resetReason,
        ...(resetByTaskKey ? { resetByTaskKey } : {}),
      },
    });
  }

  await appendEvent({
    runId,
    type: 'run.resumed',
    payload: {
      mode: mode.kind,
      resumedTasks: plan.resetKeys.length,
      doneReused: plan.doneCount,
      ...(resetByTaskKey ? { fromTaskKey: resetByTaskKey } : {}),
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
