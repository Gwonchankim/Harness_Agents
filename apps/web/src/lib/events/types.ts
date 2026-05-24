// Phase 4 RunEvent vocabulary. The DB column `RunEvent.payload` stores a JSON
// string; these types are compile-time only. Phase 5 will extend with result /
// feedback / revision events; Phase 4 ends a run with `run.completed`.

export type Phase4EventType =
  | 'run.started'
  | 'plan.created'
  | 'task.started'
  | 'agent.output.delta'
  | 'agent.output.completed'
  | 'task.completed'
  | 'task.failed'
  | 'task.retry.attempt'
  | 'result.created'
  | 'run.completed'
  | 'run.cancelled'
  | 'run.resumed';

export interface RunStartedPayload {
  teamId: string;
}

export interface PlanCreatedPayload {
  planId: string;
  taskCount: number;
  rationale: string;
}

export interface TaskStartedPayload {
  taskKey: string;
  agentName: string;
  title: string;
}

export interface AgentOutputDeltaPayload {
  taskKey: string;
  text: string;
  truncated?: boolean;
  originalBytes?: number;
}

export interface AgentOutputCompletedPayload {
  taskKey: string;
  bytes: number;
}

export interface TaskCompletedPayload {
  taskKey: string;
  status: 'done';
  durationMs: number;
}

export interface TaskFailedPayload {
  taskKey: string;
  status: 'failed';
  error: string;
  durationMs: number;
}

export interface TaskRetryAttemptPayload {
  taskKey: string;
  attempt: number;
  kind: string;
  delayMs: number;
}

export interface ResultCreatedPayload {
  artifactId: string;
  path: string;
  bytes: number;
}

export interface RunCompletedPayload {
  success: boolean;
  succeededTasks: number;
  failedTasks: number;
  failedReason?: string;
}

export interface RunCancelledPayload {
  failedReason: 'user_cancelled';
  cancelledTasks: number;
}

export interface RunResumedPayload {
  mode: 'auto' | 'fromTask';
  resumedTasks: number;
  doneReused: number;
  fromTaskKey?: string;
}

// ---------------------------------------------------------------------------
// Phase 5 — revision lifecycle events. `result.created` (above) is unchanged.
// ---------------------------------------------------------------------------

export type Phase5EventType =
  | 'revision.proposed'
  | 'revision.approved'
  | 'revision.rejected';

export interface RevisionProposedPayload {
  baseRevisionId: string;
  changedAgents: number;
  added: number;
  removed: number;
  reason: string;
}

export interface RevisionApprovedPayload {
  revisionId: string;
  version: number;
}

export interface RevisionRejectedPayload {
  baseRevisionId: string | null;
}
