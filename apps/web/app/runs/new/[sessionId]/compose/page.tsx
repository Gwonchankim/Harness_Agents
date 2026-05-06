import { notFound, redirect } from 'next/navigation';

import { TeamComposer } from '@/components/team/TeamComposer';

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
  return (
    <section className="space-y-6">
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
