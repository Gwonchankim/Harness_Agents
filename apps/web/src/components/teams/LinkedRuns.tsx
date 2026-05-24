import Link from 'next/link';

import type { TeamDetailRun } from '@lib/teams/teamDetail';

export function LinkedRuns({ runs }: { runs: TeamDetailRun[] }) {
  if (runs.length === 0) {
    return <p className="text-sm opacity-65">No runs have used this team yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {runs.map((run) => (
        <li key={run.id} className="rounded-md border border-current/15 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-current/15 px-2 py-0.5 text-xs opacity-70">
                  {run.status}
                </span>
                <span className="text-xs opacity-50">
                  {run.createdAt.toLocaleString()}
                </span>
              </div>
              <p className="line-clamp-2 opacity-75">{run.prompt}</p>
              {run.failedReason ? (
                <p className="text-xs text-rose-600">{run.failedReason}</p>
              ) : null}
            </div>
            <Link
              href={`/runs/${run.id}` as never}
              className="shrink-0 rounded-md border border-current/30 px-3 py-1 text-xs font-medium hover:bg-current/5"
            >
              Open run
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
