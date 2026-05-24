// Pure resume-plan policy. Decides whether a failed/cancelled run can be resumed
// in place and which task keys must be reset to `pending` before re-execution.
//
// Phase 8 decision: only failed/cancelled tasks are reset (done tasks are kept and
// their results reused). Both run-level resume ('auto') and (failed/cancelled)
// task-level retry ('fromTask') reset the SAME set — every non-done task — so the
// run can run to completion; the only difference is that 'fromTask' additionally
// requires the named task to be failed/cancelled. Force-rerunning a DONE task with
// transitive downstream invalidation is deferred to Phase 9.

const RESETTABLE = new Set(['failed', 'cancelled']);

export type ResumeMode = { kind: 'auto' } | { kind: 'fromTask'; targetKey: string };

export interface ResumeTaskInput {
  taskKey: string;
  status: string;
}

export type ResumeIneligibleReason =
  | 'no_plan'
  | 'no_reusable_done_tasks'
  | 'no_resumable_tasks'
  | 'target_not_found'
  | 'task_not_retryable';

export interface ResumePlanResult {
  eligible: boolean;
  reason?: ResumeIneligibleReason;
  /** Task keys (failed/cancelled) to reset to `pending` before re-execution. */
  resetKeys: string[];
  /** Count of done tasks whose results will be reused (for UI copy). */
  doneCount: number;
}

export function computeResumePlan(input: {
  planExists: boolean;
  tasks: readonly ResumeTaskInput[];
  mode: ResumeMode;
}): ResumePlanResult {
  const { planExists, tasks, mode } = input;
  const doneCount = tasks.filter((t) => t.status === 'done').length;

  if (!planExists) {
    return { eligible: false, reason: 'no_plan', resetKeys: [], doneCount };
  }

  if (doneCount === 0) {
    return { eligible: false, reason: 'no_reusable_done_tasks', resetKeys: [], doneCount };
  }

  if (mode.kind === 'fromTask') {
    const target = tasks.find((t) => t.taskKey === mode.targetKey);
    if (!target) {
      return { eligible: false, reason: 'target_not_found', resetKeys: [], doneCount };
    }
    if (!RESETTABLE.has(target.status)) {
      return { eligible: false, reason: 'task_not_retryable', resetKeys: [], doneCount };
    }
  }

  const resetKeys = tasks.filter((t) => RESETTABLE.has(t.status)).map((t) => t.taskKey);
  if (resetKeys.length === 0) {
    return { eligible: false, reason: 'no_resumable_tasks', resetKeys: [], doneCount };
  }

  return { eligible: true, resetKeys, doneCount };
}
