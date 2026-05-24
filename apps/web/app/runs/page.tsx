import Link from 'next/link';

import { listRuns, normalizeStatusFilter } from '@lib/runs/list';
import { resumeTarget } from '@lib/runs/resumeTarget';
import { ensureRecovered } from '@lib/runtime/recovery';

import { RunFilterBar } from '@/components/runs/RunFilterBar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ status?: string; q?: string }>;
}

export default async function RunsPage({ searchParams }: PageProps) {
  await ensureRecovered();
  const sp = await searchParams;
  const status = normalizeStatusFilter(sp.status);
  const q = (sp.q ?? '').trim();
  const runs = await listRuns({ status, q });

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <p className="text-sm opacity-65">
          Browse every project run, filter by status, and jump back into the right step.
        </p>
      </div>

      <RunFilterBar status={status} q={q} />

      <div className="flex items-center justify-between text-xs opacity-55">
        <span>{runs.length} shown</span>
        <Link href="/runs/new" className="underline underline-offset-4">
          New run
        </Link>
      </div>

      {runs.length === 0 ? (
        <p className="rounded-lg border border-current/15 p-5 text-sm opacity-70">
          No runs match this filter.
        </p>
      ) : (
        <ul className="space-y-3">
          {runs.map((run) => {
            const resume = resumeTarget({
              id: run.id,
              status: run.status,
              qaSession: run.qaSession,
            });
            return (
              <li key={run.id} className="rounded-lg border border-current/15 p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium">{run.projectName}</h2>
                      <span className="rounded-full border border-current/15 px-2 py-0.5 text-xs opacity-70">
                        {resume.label}
                      </span>
                      {run.teamName ? (
                        <span className="text-xs opacity-60">Team: {run.teamName}</span>
                      ) : null}
                    </div>
                    <p className="line-clamp-2 opacity-75">{run.prompt}</p>
                    {run.failedReason ? (
                      <p className="text-xs text-rose-600">Needs attention: {run.failedReason}</p>
                    ) : null}
                    <p className="text-xs opacity-50">Updated {run.updatedAt.toLocaleString()}</p>
                  </div>
                  <Link
                    href={resume.href as never}
                    className="shrink-0 rounded-md border border-current/30 px-3 py-1 text-xs font-medium hover:bg-current/5"
                  >
                    Continue
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
