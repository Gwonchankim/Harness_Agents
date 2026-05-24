import { notFound } from 'next/navigation';

import { prisma } from '@db/client';
import { parseJson } from '@lib/db/json';
import { listEnabledModels } from '@lib/models/catalog';
import {
  buildFinalResultMarkdown,
  loadRunResultMarkdown,
} from '@lib/results/finalResult';
import { ensureRecovered } from '@lib/runtime/recovery';

import { RunContextHeader } from '@/components/run/RunContextHeader';
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
      <section className="space-y-6">
        <RunContextHeader
          title={`Run ${run.id.slice(0, 12)}...`}
          prompt={run.prompt}
          status={run.status}
        />
        <p className="text-sm opacity-70">No team is attached to this run yet.</p>
      </section>
    );
  }

  const [tasks, recentEvents, modelCatalog, storedFinalResult] = await Promise.all([
    prisma.task.findMany({
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
    }),
    prisma.runEvent.findMany({
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
    }),
    listEnabledModels(),
    loadRunResultMarkdown(runId),
  ]);
  const mappedTasks = tasks.map((t) => ({
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
  }));
  const agentById = new Map(run.team.agents.map((agent) => [agent.id, agent] as const));
  const fallbackFinalResult =
    !storedFinalResult && run.status === 'succeeded'
      ? buildFinalResultMarkdown({
          runId: run.id,
          userPrompt: run.prompt,
          teamName: run.team.name,
          tasks: mappedTasks.map((task) => ({
            taskKey: task.taskKey,
            title: task.name,
            agentName: task.agentId
              ? (agentById.get(task.agentId)?.name ?? 'Unknown agent')
              : 'Unknown agent',
            text: task.result ?? '',
          })),
        })
      : null;

  return (
    <section className="space-y-6">
      <RunContextHeader
        title={`Run ${run.id.slice(0, 12)}...`}
        prompt={run.prompt}
        status={run.failedReason ? `${run.status} (${run.failedReason})` : run.status}
        teamName={run.team.name}
      />

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
          tasks: mappedTasks,
          events: recentEvents.map((e) => ({
            id: e.id,
            type: e.type,
            taskId: e.taskId,
            agentId: e.agentId,
            payload: parseJson<unknown>(e.payload, {}),
            createdAt: e.createdAt.toISOString(),
          })),
          modelCatalog: modelCatalog.map((m) => ({
            modelId: m.modelId,
            displayName: m.displayName,
            provider: m.provider,
            isDefault: m.isDefault,
          })),
          finalResult: storedFinalResult ?? fallbackFinalResult,
        }}
      />
    </section>
  );
}
