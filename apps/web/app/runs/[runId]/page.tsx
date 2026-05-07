import { notFound } from 'next/navigation';

import { prisma } from '@db/client';
import { parseJson } from '@lib/db/json';

import { ensureRecovered } from '@lib/runtime/recovery';

import { RunStream } from '@/components/run/RunStream';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ runId: string }>;
}

export default async function RunDetailPage({ params }: PageProps) {
  await ensureRecovered();
  const { runId } = await params;

  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      prompt: true,
      failedReason: true,
      startedAt: true,
      endedAt: true,
      createdAt: true,
      team: {
        select: {
          id: true,
          name: true,
          description: true,
          agents: {
            select: {
              id: true,
              name: true,
              role: true,
              isLead: true,
              modelId: true,
              provider: true,
              createdAt: true,
            },
            orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
    },
  });
  if (!run) notFound();

  if (!run.team) {
    return (
      <section className="space-y-3 text-sm">
        <h1 className="text-xl font-medium">Run {run.id}</h1>
        <p className="opacity-70">No team is attached to this run yet.</p>
      </section>
    );
  }

  const tasks = await prisma.task.findMany({
    where: { runId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      taskKey: true,
      name: true,
      description: true,
      status: true,
      agentId: true,
      dependencies: true,
      startedAt: true,
      completedAt: true,
      result: true,
      error: true,
    },
  });

  const recentEvents = await prisma.runEvent.findMany({
    where: { runId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 1000,
    select: {
      id: true,
      type: true,
      taskId: true,
      agentId: true,
      payload: true,
      createdAt: true,
    },
  });

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-medium">Run {run.id.slice(0, 12)}…</h1>
        <p className="text-xs opacity-70">
          Team: <span className="font-mono">{run.team.name}</span> · Status:{' '}
          <span className="font-mono">{run.status}</span>
          {run.failedReason ? (
            <span className="ml-1 text-rose-500">({run.failedReason})</span>
          ) : null}
        </p>
        <div className="rounded-md border border-current/15 p-3 text-xs">
          <span className="opacity-70">Prompt:</span> {run.prompt}
        </div>
      </header>

      <RunStream
        runId={run.id}
        initial={{
          status: run.status,
          failedReason: run.failedReason,
          team: {
            id: run.team.id,
            name: run.team.name,
            agents: run.team.agents.map((a) => ({
              id: a.id,
              name: a.name,
              role: a.role,
              isLead: a.isLead,
              provider: a.provider,
              modelId: a.modelId,
            })),
          },
          tasks: tasks.map((t) => ({
            id: t.id,
            taskKey: t.taskKey,
            name: t.name,
            description: t.description,
            status: t.status,
            agentId: t.agentId,
            dependencies: parseJson<string[]>(t.dependencies, []),
            startedAt: t.startedAt?.toISOString() ?? null,
            completedAt: t.completedAt?.toISOString() ?? null,
            result: t.result
              ? (parseJson<{ text?: string }>(t.result, {}).text ?? null)
              : null,
            error: t.error,
          })),
          events: recentEvents.map((e) => ({
            id: e.id,
            type: e.type,
            taskId: e.taskId,
            agentId: e.agentId,
            payload: parseJson<unknown>(e.payload, {}),
            createdAt: e.createdAt.toISOString(),
          })),
        }}
      />
    </section>
  );
}
