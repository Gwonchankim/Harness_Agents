// Pure resume-plan policy. Decides whether a run can be resumed / re-run in place
// and which task keys must be reset to `pending` before re-execution.
//
// Modes:
//   - 'auto'          (Phase 8 run-level resume): reset every failed/cancelled task.
//   - 'fromTask'      (Phase 8 task-level retry): target must be failed/cancelled;
//                     resets every failed/cancelled task (same effect as 'auto').
//   - 'rerunFromTask' (Phase 9): target may be done/failed/cancelled. Resets the
//                     target + its transitive downstream (their inputs change when
//                     the target re-runs) + every failed/cancelled task (so the run
//                     can run to completion). Done tasks NOT in the reset set keep
//                     their results and are reused as upstream context.
//
// Pure: the executor + lib/runs/resume.ts wire Prisma around this.

import { transitiveDownstream } from '@lib/dag/downstream';

const RESETTABLE = new Set(['failed', 'cancelled']);
const RERUNNABLE_TARGET = new Set(['done', 'failed', 'cancelled']);

export type ResumeMode =
  | { kind: 'auto' }
  | { kind: 'fromTask'; targetKey: string }
  | { kind: 'rerunFromTask'; targetKey: string };

export interface ResumeTaskInput {
  taskKey: string;
  status: string;
  dependencies: readonly string[];
}

export type ResumeIneligibleReason =
  | 'no_plan'
  | 'no_reusable_done_tasks'
  | 'no_resumable_tasks'
  | 'target_not_found'
  | 'task_not_retryable'
  | 'task_not_rerunnable';

export interface ResumePlanResult {
  eligible: boolean;
  reason?: ResumeIneligibleReason;
  /** Task keys to reset to `pending` before re-execution. */
  resetKeys: string[];
  /** Count of done tasks that are kept and reused (NOT reset) — for UI copy. */
  doneCount: number;
}

export function computeResumePlan(input: {
  planExists: boolean;
  tasks: readonly ResumeTaskInput[];
  mode: ResumeMode;
}): ResumePlanResult {
  const { planExists, tasks, mode } = input;
  const totalDone = tasks.filter((t) => t.status === 'done').length;

  if (!planExists) {
    return { eligible: false, reason: 'no_plan', resetKeys: [], doneCount: totalDone };
  }
  if (totalDone === 0) {
    return { eligible: false, reason: 'no_reusable_done_tasks', resetKeys: [], doneCount: 0 };
  }

  let resetKeys: string[];

  if (mode.kind === 'rerunFromTask') {
    const target = tasks.find((t) => t.taskKey === mode.targetKey);
    if (!target) {
      return { eligible: false, reason: 'target_not_found', resetKeys: [], doneCount: totalDone };
    }
    if (!RERUNNABLE_TARGET.has(target.status)) {
      return { eligible: false, reason: 'task_not_rerunnable', resetKeys: [], doneCount: totalDone };
    }
    const downstream = transitiveDownstream(tasks, target.taskKey);
    const failedOrCancelled = tasks.filter((t) => RESETTABLE.has(t.status)).map((t) => t.taskKey);
    const existing = new Set(tasks.map((t) => t.taskKey));
    resetKeys = [
      ...new Set<string>([target.taskKey, ...downstream, ...failedOrCancelled]),
    ].filter((k) => existing.has(k));
  } else {
    if (mode.kind === 'fromTask') {
      const target = tasks.find((t) => t.taskKey === mode.targetKey);
      if (!target) {
        return { eligible: false, reason: 'target_not_found', resetKeys: [], doneCount: totalDone };
      }
      if (!RESETTABLE.has(target.status)) {
        return {
          eligible: false,
          reason: 'task_not_retryable',
          resetKeys: [],
          doneCount: totalDone,
        };
      }
    }
    resetKeys = tasks.filter((t) => RESETTABLE.has(t.status)).map((t) => t.taskKey);
  }

  if (resetKeys.length === 0) {
    return { eligible: false, reason: 'no_resumable_tasks', resetKeys: [], doneCount: totalDone };
  }

  const resetSet = new Set(resetKeys);
  const doneReused = tasks.filter((t) => t.status === 'done' && !resetSet.has(t.taskKey)).length;
  return { eligible: true, resetKeys, doneCount: doneReused };
}
