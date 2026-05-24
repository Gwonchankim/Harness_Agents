import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { executeResume } from '@lib/dag/executor';
import { clearRunController, registerRunController } from '@lib/dag/runRegistry';
import { isResumeError, prepareResume } from '@lib/runs/resume';
import { ensureRecovered } from '@lib/runtime/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Task-level retry (Phase 8): re-run from a specific failed/cancelled task. Under
// the hood it is the same in-place resume — only failed/cancelled tasks reset and
// run; done tasks are reused. Force-rerunning a DONE task (with transitive
// downstream invalidation) is deferred to Phase 9 and rejected here as
// `task_not_retryable`.
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

  const result = await prepareResume(runId, { kind: 'fromTask', targetKey: task.taskKey });
  if (isResumeError(result)) {
    return NextResponse.json(
      { error: result.error, status: result.runStatus },
      { status: result.status },
    );
  }

  const controller = new AbortController();
  registerRunController(runId, controller);
  void executeResume(runId, { signal: controller.signal })
    .catch((err) => {
      console.error(`executeResume threw for runId=${runId}:`, err);
    })
    .finally(() => {
      clearRunController(runId);
    });

  return NextResponse.json(result);
}
