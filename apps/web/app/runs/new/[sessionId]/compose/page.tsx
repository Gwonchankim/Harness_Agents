import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { TeamComposer } from '@/components/team/TeamComposer';
import { RunContextHeader } from '@/components/run/RunContextHeader';
import { StartRunButton } from '@/components/run/StartRunButton';

import { prisma } from '@db/client';
import { loadSession } from '@lib/qa/sessionState';

export const dynamic = 'force-dynamic';

export default async function ComposePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  // Read-only: this server component must not mutate the DB. The client
  // island calls /api/teams/recommend and /api/teams.
  const session = await loadSession(sessionId);
  if (!session) notFound();
  if (!session.isComplete) {
    redirect(`/runs/new/${sessionId}` as never);
  }
  const run = await prisma.run.findUnique({
    where: { id: session.runId },
    select: {
      id: true,
      prompt: true,
      status: true,
      teamId: true,
      team: { select: { name: true } },
    },
  });

  if (run?.teamId) {
    return (
      <section className="space-y-6">
        <RunContextHeader
          title={`Run ${session.runId.slice(0, 12)}...`}
          prompt={run.prompt}
          status={run.status}
          teamName={run.team?.name ?? null}
        />
        <AlreadyComposedPanel
          runId={run.id}
          teamId={run.teamId}
          status={run.status}
          teamName={run.team?.name ?? null}
        />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <RunContextHeader
        title={`Run ${session.runId.slice(0, 12)}...`}
        prompt={run?.prompt ?? ''}
        status={run?.status ?? session.status}
        teamName={run?.team?.name ?? null}
      />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Compose team</h1>
        <p className="text-sm opacity-70">
          Pick a recalled team or edit the proposed one. Confirming creates the team and
          marks the run ready for execution.
        </p>
      </div>
      <TeamComposer sessionId={sessionId} />
    </section>
  );
}

function AlreadyComposedPanel({
  runId,
  teamId,
  status,
  teamName,
}: {
  runId: string;
  teamId: string;
  status: string;
  teamName: string | null;
}) {
  const canStart = status === 'ready';
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Team already composed</h1>
        <p className="text-sm opacity-70">
          {canStart
            ? 'This run already has a confirmed team. Start the DAG executor directly from here.'
            : 'This run already has a confirmed team. Open the run detail page to continue.'}
        </p>
      </div>

      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-800 dark:text-emerald-200">
        <h2 className="text-base font-medium">
          {teamName ? `${teamName} is ready` : 'Team is ready'}
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div>
            <dt className="opacity-70">Run ID</dt>
            <dd className="break-all font-mono">{runId}</dd>
          </div>
          <div>
            <dt className="opacity-70">Team ID</dt>
            <dd className="break-all font-mono">{teamId}</dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap gap-2">
        {canStart ? (
          <StartRunButton runId={runId} />
        ) : (
          <Link
            href={`/runs/${runId}` as never}
            className="inline-block rounded-md border border-current/30 px-3 py-1 text-xs font-medium hover:bg-current/5"
          >
            Open run →
          </Link>
        )}
        <Link
          href="/"
          className="inline-block rounded-md border border-current/30 px-3 py-1 text-xs font-medium hover:bg-current/5"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
