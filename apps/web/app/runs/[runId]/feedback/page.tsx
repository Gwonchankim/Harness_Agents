import Link from 'next/link';
import { notFound } from 'next/navigation';

import { prisma } from '@db/client';
import { parseJson } from '@lib/db/json';
import { buildFinalResultMarkdown, loadRunResultMarkdown } from '@lib/results/finalResult';
import { ensureRecovered } from '@lib/runtime/recovery';

import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import { RunContextHeader } from '@/components/run/RunContextHeader';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ runId: string }>;
}

export default async function FeedbackPage({ params }: PageProps) {
  await ensureRecovered();
  const { runId } = await params;

  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      prompt: true,
      team: {
        select: {
          id: true,
          name: true,
          agents: {
            select: { id: true, name: true, role: true, isLead: true, createdAt: true },
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
        <RunContextHeader title={`Feedback — Run ${run.id.slice(0, 12)}...`} prompt={run.prompt} status={run.status} />
        <p className="text-sm opacity-70">No team is attached to this run.</p>
        <BackLink runId={run.id} />
      </section>
    );
  }

  if (run.status !== 'succeeded') {
    return (
      <section className="space-y-6">
        <RunContextHeader
          title={`Feedback — Run ${run.id.slice(0, 12)}...`}
          prompt={run.prompt}
          status={run.status}
          teamName={run.team.name}
        />
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
          Feedback is available once the run has succeeded. Current status: {run.status}.
        </p>
        <BackLink runId={run.id} />
      </section>
    );
  }

  const [tasks, stored] = await Promise.all([
    prisma.task.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
      select: { taskKey: true, name: true, status: true, agentId: true, result: true },
    }),
    loadRunResultMarkdown(runId),
  ]);

  const agentById = new Map(run.team.agents.map((a) => [a.id, a] as const));
  const mappedTasks = tasks.map((t) => ({
    taskKey: t.taskKey,
    title: t.name,
    status: t.status,
    agentId: t.agentId,
    text: t.result ? (parseJson<{ text?: string }>(t.result, {}).text ?? '') : '',
  }));

  const resultMarkdown =
    stored ??
    buildFinalResultMarkdown({
      runId: run.id,
      userPrompt: run.prompt,
      teamName: run.team.name,
      tasks: mappedTasks.map((t) => ({
        taskKey: t.taskKey,
        title: t.title,
        agentName: t.agentId ? (agentById.get(t.agentId)?.name ?? 'Unknown agent') : 'Unknown agent',
        text: t.text,
      })),
    });

  const agents = run.team.agents.map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    isLead: a.isLead,
    tasks: mappedTasks
      .filter((t) => t.agentId === a.id)
      .map((t) => ({ taskKey: t.taskKey, title: t.title, status: t.status, text: t.text })),
  }));

  return (
    <section className="space-y-6">
      <RunContextHeader
        title={`Feedback — Run ${run.id.slice(0, 12)}...`}
        prompt={run.prompt}
        status={run.status}
        teamName={run.team.name}
      />
      <BackLink runId={run.id} />
      <FeedbackForm runId={run.id} resultMarkdown={resultMarkdown} agents={agents} />
    </section>
  );
}

function BackLink({ runId }: { runId: string }) {
  return (
    <Link
      href={`/runs/${runId}` as never}
      className="inline-block text-sm underline underline-offset-4 opacity-75 hover:opacity-100"
    >
      ← Back to run
    </Link>
  );
}
