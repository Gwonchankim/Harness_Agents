import { NextResponse } from 'next/server';

import { cancelRun, isCancelError } from '@lib/runs/cancel';
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

  const result = await cancelRun(runId);
  if (isCancelError(result)) {
    return NextResponse.json(
      { error: result.error, status: result.runStatus },
      { status: result.status },
    );
  }

  return NextResponse.json(result);
}
