import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { executeResume } from '@lib/dag/executor';
import { clearRunController, registerRunController } from '@lib/dag/runRegistry';
import { isResumeError, prepareResume } from '@lib/runs/resume';
import { ensureRecovered } from '@lib/runtime/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Task-level re-run from a specific task (Phase 9 `rerunFromTask`, generalizing the
// Phase 8 failed/cancelled retry). resetKeys = target + its transitive downstream +
// every failed/cancelled task. For a failed/cancelled target this is identical to
// the Phase 8 behavior (downstream is still pending); for a DONE target on a
// terminal run (failed | succeeded) it forces a recompute of the target and its
// dependents, reusing upstream done results.
export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string; taskId: string }> },
) {
  await ensureRecovered();
  const { runId, taskId } = await context.params;
  if (!runId || !taskId) {
    return NextResponse.json({ error: 'params_required' }, { status: 400 });
  }

  const task = await prisma.task.findFirst({
    where: { id: taskId, runId },
    select: { taskKey: true },
  });
  if (!task) {
    return NextResponse.json({ error: 'task_not_found' }, { status: 404 });
  }

  const result = await prepareResume(runId, { kind: 'rerunFromTask', targetKey: task.taskKey });
  if (isResumeError(result)) {
    return NextResponse.json(
      { error: result.error, status: result.runStatus },
      { status: result.status },
    );
  }

  const controller = new AbortController();
  registerRunController(runId, controller);
  void executeResume(runId, { signal: controller.signal, source: 'rerun_from_task' })
    .catch((err) => {
      console.error(`executeResume threw for runId=${runId}:`, err);
    })
    .finally(() => {
      clearRunController(runId);
    });

  return NextResponse.json(result);
}
