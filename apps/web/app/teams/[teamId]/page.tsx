import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadTeamDetail } from '@lib/teams/teamDetail';

import { LinkedRuns } from '@/components/teams/LinkedRuns';
import { RevisionHistory } from '@/components/teams/RevisionHistory';
import { SnapshotPreview } from '@/components/teams/SnapshotPreview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ teamId: string }>;
}

export default async function TeamDetailPage({ params }: PageProps) {
  const { teamId } = await params;
  const team = await loadTeamDetail(teamId);
  if (!team) notFound();

  const revisions = team.revisions.map((r) => ({
    id: r.id,
    version: r.version,
    proposedBy: r.proposedBy,
    approvedBy: r.approvedBy,
    reason: r.reason,
    sourceRunId: r.sourceRunId,
    createdAt: r.createdAt.toISOString(),
    approvedAt: r.approvedAt?.toISOString() ?? null,
    agentsMd: r.agentsMd,
    teamJson: r.teamJson,
  }));

  return (
    <section className="space-y-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/teams" className="text-sm underline underline-offset-4 opacity-70 hover:opacity-100">
            ← Team Library
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
          {team.currentVersion != null ? (
            <span className="rounded-full border border-current/15 px-2 py-0.5 text-xs opacity-70">
              v{team.currentVersion} active
            </span>
          ) : null}
          <span className="rounded-full border border-current/15 px-2 py-0.5 text-xs opacity-70">
            {team.status}
          </span>
        </div>
        {team.description ? <p className="max-w-2xl opacity-75">{team.description}</p> : null}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs opacity-65">
          <div>
            <dt className="inline opacity-70">Domain: </dt>
            <dd className="inline">{team.domain ?? '—'}</dd>
          </div>
          <div>
            <dt className="inline opacity-70">Tags: </dt>
            <dd className="inline">{team.tags.length > 0 ? team.tags.join(', ') : '—'}</dd>
          </div>
          <div>
            <dt className="inline opacity-70">Score: </dt>
            <dd className="inline">{team.score != null ? team.score : '—'}</dd>
          </div>
          <div>
            <dt className="inline opacity-70">Result rating avg: </dt>
            <dd className="inline">
              {team.resultRatingAvg != null
                ? `${team.resultRatingAvg} (${team.resultRatingCount})`
                : '—'}
            </dd>
          </div>
        </dl>
      </header>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Agents</h2>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {team.agents.map((agent) => (
            <li key={agent.id} className="rounded-lg border border-current/15 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {agent.name}
                  {agent.isLead ? ' (Lead)' : ''}
                </span>
                <span className="text-xs opacity-60">
                  {agent.ratingAvg != null ? `★ ${agent.ratingAvg} (${agent.ratingCount})` : 'no ratings'}
                </span>
              </div>
              <p className="mt-1 text-xs opacity-70">{agent.role}</p>
              <dl className="mt-2 space-y-1 text-xs opacity-65">
                <div>
                  <dt className="inline opacity-70">Model: </dt>
                  <dd className="inline">
                    {agent.modelId} ({agent.provider})
                  </dd>
                </div>
                <div>
                  <dt className="inline opacity-70">Tools: </dt>
                  <dd className="inline">
                    {agent.toolsAllowed.length > 0 ? agent.toolsAllowed.join(', ') : 'none'}
                  </dd>
                </div>
                {agent.tags.length > 0 ? (
                  <div>
                    <dt className="inline opacity-70">Tags: </dt>
                    <dd className="inline">{agent.tags.join(', ')}</dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Active snapshot</h2>
        <SnapshotPreview agentsMd={team.agentsMd} teamJson={team.teamJson} />
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Revision history</h2>
        <RevisionHistory revisions={revisions} />
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-medium">Linked runs</h2>
        <LinkedRuns runs={team.runs} />
      </div>
    </section>
  );
}
