import Link from 'next/link';

import { prisma } from '@db/client';
import { resumeTarget } from '@lib/runs/resumeTarget';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const runs = await prisma.run.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 20,
    select: {
      id: true,
      prompt: true,
      status: true,
      failedReason: true,
      updatedAt: true,
      project: { select: { name: true } },
      team: { select: { name: true } },
      qaSession: { select: { id: true, status: true } },
    },
  });

  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Harness Agents</h1>
        <p className="max-w-2xl opacity-70">
          Local-first multi-agent workspace. Start a new run, or resume one of the
          existing project runs below.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <li className="rounded-lg border border-current/15 p-5">
          <h2 className="text-base font-medium">Start a new run</h2>
          <p className="mt-1 text-sm opacity-70">
            Enter a prompt, pick a PO model, and walk through dynamic clarification cards.
          </p>
          <Link
            href="/runs/new"
            className="mt-3 inline-block text-sm font-medium underline underline-offset-4"
          >
            New run
          </Link>
        </li>
        <li className="rounded-lg border border-current/15 p-5">
          <h2 className="text-base font-medium">Team Library</h2>
          <p className="mt-1 text-sm opacity-70">
            Browse reusable agent teams, inspect their agents, current revision, and
            revision history.
          </p>
          <Link
            href="/teams"
            className="mt-3 inline-block text-sm font-medium underline underline-offset-4"
          >
            Open Team Library
          </Link>
        </li>
        <li className="rounded-lg border border-current/15 p-5">
          <h2 className="text-base font-medium">All runs</h2>
          <p className="mt-1 text-sm opacity-70">
            Filter every project run by status and search prompts to resume the right one.
          </p>
          <Link
            href="/runs"
            className="mt-3 inline-block text-sm font-medium underline underline-offset-4"
          >
            Browse runs
          </Link>
        </li>
        <li className="rounded-lg border border-current/15 p-5">
          <h2 className="text-base font-medium">Settings</h2>
          <p className="mt-1 text-sm opacity-70">
            Add provider keys, see the active storage backend, and check
            per-provider availability against the seeded model catalog.
          </p>
          <Link
            href="/settings"
            className="mt-3 inline-block text-sm font-medium underline underline-offset-4"
          >
            Open settings
          </Link>
        </li>
      </ul>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">Existing project runs</h2>
            <p className="text-sm opacity-65">
              See where each run stopped and jump back into the right step.
            </p>
          </div>
          <Link href="/runs" className="text-xs underline underline-offset-4 opacity-65 hover:opacity-100">
            View all runs →
          </Link>
        </div>

        {runs.length === 0 ? (
          <p className="rounded-lg border border-current/15 p-5 text-sm opacity-70">
            No runs yet. Start a new run to create the first project record.
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
                <li
                  key={run.id}
                  className="rounded-lg border border-current/15 p-4 text-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium">{run.project.name}</h3>
                        <span className="rounded-full border border-current/15 px-2 py-0.5 text-xs opacity-70">
                          {resume.label}
                        </span>
                        {run.team ? (
                          <span className="text-xs opacity-60">Team: {run.team.name}</span>
                        ) : null}
                      </div>
                      <p className="line-clamp-2 opacity-75">{run.prompt}</p>
                      {run.failedReason ? (
                        <p className="text-xs text-rose-600">Needs attention: {run.failedReason}</p>
                      ) : null}
                      <p className="text-xs opacity-50">
                        Updated {run.updatedAt.toLocaleString()}
                      </p>
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
    </section>
  );
}
