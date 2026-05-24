import Link from 'next/link';

import type { TeamLibraryItem } from '@lib/teams/library';

export function TeamCard({ team }: { team: TeamLibraryItem }) {
  return (
    <li className="rounded-lg border border-current/15 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/teams/${team.id}` as never}
              className="font-medium underline-offset-4 hover:underline"
            >
              {team.name}
            </Link>
            {team.currentVersion != null ? (
              <span className="rounded-full border border-current/15 px-2 py-0.5 text-xs opacity-70">
                v{team.currentVersion}
              </span>
            ) : null}
            {team.domain ? (
              <span className="text-xs opacity-60">{team.domain}</span>
            ) : null}
          </div>
          {team.description ? (
            <p className="line-clamp-2 opacity-75">{team.description}</p>
          ) : null}
          {team.tags.length > 0 ? (
            <p className="text-xs opacity-55">{team.tags.join(', ')}</p>
          ) : null}
        </div>
        <div className="shrink-0 text-right text-xs opacity-60">
          <div>{team.agentCount} agents</div>
          <div>{team.runCount} runs</div>
          <div>{team.score != null ? `score ${team.score}` : 'score —'}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs opacity-55">
        <span>{team.leadAgentName ? `Lead: ${team.leadAgentName}` : 'No lead'}</span>
        <span>Updated {team.updatedAt.toLocaleDateString()}</span>
      </div>
    </li>
  );
}
