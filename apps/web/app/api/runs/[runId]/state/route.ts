// Polling fallback for `/api/runs/[runId]/events`. Returns the run summary, the
// task list, and any new events since the cursor. Designed for clients that
// can't open a long-lived EventSource (e.g. corporate proxies that buffer SSE).

import { NextResponse } from 'next/server';

import { prisma } from '@db/client';
import { parseJson } from '@lib/db/json';

import { ensureRecovered } from '@lib/runtime/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  await ensureRecovered();
  const { runId } = await context.params;
  const url = new URL(request.url);
  const since = url.searchParams.get('since');

  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      prompt: true,
      failedReason: true,
      startedAt: true,
      endedAt: true,
      team: { select: { id: true, name: true } },
    },
  });
  if (!run) {
    return NextResponse.json({ error: 'run_not_found' }, { status: 404 });
  }

  const events = await prisma.runEvent.findMany({
    where: { runId, ...(since ? { id: { gt: since } } : {}) },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 1000,
  });

  const tasks = await prisma.task.findMany({
    where: { runId },
    orderBy: { createdAt: 'asc' },
  });

  const lastEventId = events.length > 0 ? events[events.length - 1]!.id : since;

  return NextResponse.json({
    run: {
      id: run.id,
      status: run.status,
      failedReason: run.failedReason,
      startedAt: run.startedAt?.toISOString() ?? null,
      endedAt: run.endedAt?.toISOString() ?? null,
      team: run.team,
    },
    tasks: tasks.map((t) => ({
      id: t.id,
      taskKey: t.taskKey,
      name: t.name,
      status: t.status,
      agentId: t.agentId,
      dependencies: parseJson<string[]>(t.dependencies, []),
      startedAt: t.startedAt?.toISOString() ?? null,
      completedAt: t.completedAt?.toISOString() ?? null,
      result: t.result ? parseJson<{ text?: string }>(t.result, {}).text ?? null : null,
      error: t.error,
    })),
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      taskId: e.taskId,
      agentId: e.agentId,
      payload: parseJson<unknown>(e.payload, {}),
      createdAt: e.createdAt.toISOString(),
    })),
    nextSince: lastEventId,
  });
}
