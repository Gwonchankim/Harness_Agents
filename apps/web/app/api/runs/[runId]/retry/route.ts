import { NextResponse } from 'next/server';

import { isRetryError, retryRun } from '@lib/runs/retry';
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

  const result = await retryRun(runId);
  if (isRetryError(result)) {
    return NextResponse.json(
      { error: result.error, status: result.runStatus },
      { status: result.status },
    );
  }

  return NextResponse.json({ ok: true, ...result });
}
