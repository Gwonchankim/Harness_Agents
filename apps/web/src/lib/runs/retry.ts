// Retry a failed run. Hybrid strategy (Phase 6 decision #3):
//   - No ExecutionPlan was created → reset this run in place to `ready` so the
//     existing Start flow can re-run it (no row conflicts to clean up).
//   - An ExecutionPlan/Task already exists → clone a fresh run with the same team
//     and prompt, leaving the failed run as history. ExecutionPlan.runId is
//     @unique and tasks are tied to the old run, so re-running in place would
//     conflict; cloning keeps the executor untouched.

import { prisma } from '@db/client';

export type RetryResult =
  | { mode: 'reset'; runId: string }
  | { mode: 'clone'; runId: string; originalRunId: string };

export interface RetryError {
  error: 'run_not_found' | 'run_has_no_team' | 'run_not_failed';
  status: number;
  runStatus?: string;
}

export function isRetryError(value: RetryResult | RetryError): value is RetryError {
  return 'error' in value;
}

export async function retryRun(runId: string): Promise<RetryResult | RetryError> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      teamId: true,
      prompt: true,
      poModelId: true,
      projectId: true,
      plan: { select: { id: true } },
    },
  });
  if (!run) return { error: 'run_not_found', status: 404 };
  if (!run.teamId) return { error: 'run_has_no_team', status: 409 };
  if (run.status !== 'failed') {
    return { error: 'run_not_failed', status: 409, runStatus: run.status };
  }

  if (!run.plan) {
    await prisma.run.update({
      where: { id: run.id },
      data: { status: 'ready', failedReason: null, startedAt: null, endedAt: null },
    });
    return { mode: 'reset', runId: run.id };
  }

  const clone = await prisma.run.create({
    data: {
      projectId: run.projectId,
      teamId: run.teamId,
      prompt: run.prompt,
      poModelId: run.poModelId,
      status: 'ready',
    },
    select: { id: true },
  });
  return { mode: 'clone', runId: clone.id, originalRunId: run.id };
}
