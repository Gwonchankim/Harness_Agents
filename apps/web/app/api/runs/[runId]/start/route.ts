import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { executeRun } from '@lib/dag/executor';
import { clearRunController, registerRunController } from '@lib/dag/runRegistry';
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

  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true, status: true, teamId: true },
  });
  if (!run) {
    return NextResponse.json({ error: 'run_not_found' }, { status: 404 });
  }
  if (!run.teamId) {
    return NextResponse.json({ error: 'run_has_no_team' }, { status: 409 });
  }
  if (run.status !== 'ready') {
    return NextResponse.json(
      { error: 'run_not_startable', status: run.status },
      { status: 409 },
    );
  }

  // Fire-and-forget. Response returns immediately while the executor runs
  // in-process. Errors that escape the executor are logged but not surfaced
  // here — the run status / RunEvents are the canonical signal. The AbortController
  // is registered so POST /cancel can stop this run mid-flight, and cleared once
  // the executor settles.
  const controller = new AbortController();
  registerRunController(runId, controller);
  void executeRun(runId, { signal: controller.signal })
    .catch((err) => {
      console.error(`executeRun threw for runId=${runId}:`, err);
    })
    .finally(() => {
      clearRunController(runId);
    });

  return NextResponse.json({ ok: true, runId });
}
