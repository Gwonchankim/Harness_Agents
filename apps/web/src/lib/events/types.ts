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
  | 'run.completed';

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

export interface RunCompletedPayload {
  success: boolean;
  succeededTasks: number;
  failedTasks: number;
  failedReason?: string;
}
