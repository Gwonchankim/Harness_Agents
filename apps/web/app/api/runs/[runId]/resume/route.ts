import { NextResponse } from 'next/server';

import { executeResume } from '@lib/dag/executor';
import { clearRunController, registerRunController } from '@lib/dag/runRegistry';
import { isResumeError, prepareResume } from '@lib/runs/resume';
import { ensureRecovered } from '@lib/runtime/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  await ensureRecovered();
  const { runId } = await context.params;
  if (!runId) {
    return NextResponse.json({ error: 'runId_required' }, { status: 400 });
  }

  const result = await prepareResume(runId, { kind: 'auto' });
  if (isResumeError(result)) {
    return NextResponse.json(
      { error: result.error, status: result.runStatus },
      { status: result.status },
    );
  }

  // Fire-and-forget the resume executor. The AbortController is registered so
  // POST /cancel can stop it mid-flight (resume is cancellable like a fresh run),
  // and cleared once the executor settles.
  const controller = new AbortController();
  registerRunController(runId, controller);
  void executeResume(runId, { signal: controller.signal, source: 'resume' })
    .catch((err) => {
      console.error(`executeResume threw for runId=${runId}:`, err);
    })
    .finally(() => {
      clearRunController(runId);
    });

  return NextResponse.json(result);
}
