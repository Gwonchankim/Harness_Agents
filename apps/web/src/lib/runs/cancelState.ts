// Pure cancel-state policy. Phase 7 decision #1: a user-cancelled run is stored
// as Run.status='failed' + failedReason='user_cancelled' (so the existing retry /
// recovery / terminal checks need no changes), and its running + pending tasks
// become 'cancelled' while done/failed tasks are preserved. Keeping the policy in
// one pure, testable place; lib/runs/cancel.ts wires Prisma + the run registry
// around it, and lib/runs/failureClass.ts renders the user-facing copy.

export const CANCELLED_RUN_REASON = 'user_cancelled';

/** Task statuses that flip to 'cancelled' when a run is cancelled. */
export const CANCELLABLE_TASK_STATUSES = ['pending', 'running'] as const;

/** Only an in-flight run (planning or running) can be cancelled. */
export function canCancel(status: string | null | undefined): boolean {
  return status === 'planning' || status === 'running';
}

export interface CancelTransition {
  runStatus: 'failed';
  failedReason: typeof CANCELLED_RUN_REASON;
  taskStatus: 'cancelled';
  taskStatusesToCancel: readonly string[];
}

export function cancelTransition(): CancelTransition {
  return {
    runStatus: 'failed',
    failedReason: CANCELLED_RUN_REASON,
    taskStatus: 'cancelled',
    taskStatusesToCancel: CANCELLABLE_TASK_STATUSES,
  };
}
