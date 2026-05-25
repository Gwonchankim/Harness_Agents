// Pure attempt helpers (Phase 11). DB writes live in taskAttemptStore.ts; the
// attempt-pair selection for diffing lives in attemptCompare.ts. Kept prisma-free
// so it is unit-testable (mirrors the resumePlan.ts ↔ resume.ts split).

export type AttemptSource = 'initial' | 'resume' | 'rerun_from_task' | 'auto_resume';

export type AttemptStatus = 'running' | 'done' | 'failed' | 'cancelled';

/** Next 1-indexed attemptNumber for a task given its existing attempt numbers. */
export function nextAttemptNumber(existing: readonly number[]): number {
  let max = 0;
  for (const n of existing) if (n > max) max = n;
  return max + 1;
}
