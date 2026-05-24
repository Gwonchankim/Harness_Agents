import Link from 'next/link';

import { listTeams, normalizeSort, TEAM_SORTS } from '@lib/teams/library';

import { TeamCard } from '@/components/teams/TeamCard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SORT_LABELS: Record<string, string> = {
  recent: 'Recently updated',
  score: 'Highest score',
  name: 'Name (A–Z)',
};

interface PageProps {
  searchParams: Promise<{ q?: string; sort?: string }>;
}

export default async function TeamsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const sort = normalizeSort(sp.sort);
  const teams = await listTeams({ q: q || null, sort });

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Team Library</h1>
        <p className="text-sm opacity-65">
          Reusable agent teams from this workspace. Open one to see its agents, current
          revision, and history.
        </p>
      </div>

      <form method="get" action="/teams" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1 text-xs">
          <span className="opacity-65">Search</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by name, description, tags…"
            className="w-full rounded-md border border-current/20 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-current/50"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="opacity-65">Sort</span>
          <select
            name="sort"
            defaultValue={sort}
            className="rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-current/50"
          >
            {TEAM_SORTS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABELS[s] ?? s}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md border border-current/30 px-4 py-1.5 text-sm font-medium hover:bg-current/5"
        >
          Apply
        </button>
      </form>

      <div className="flex items-center justify-between text-xs opacity-55">
        <span>{teams.length} teams</span>
        <Link href="/runs/new" className="underline underline-offset-4">
          New run
        </Link>
      </div>

      {teams.length === 0 ? (
        <p className="rounded-lg border border-current/15 p-5 text-sm opacity-70">
          {q
            ? 'No teams match this search.'
            : 'No teams yet. Teams are created when you confirm a proposal during a run.'}
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {teams.map((team) => (
            <TeamCard key={team.id} team={team} />
          ))}
        </ul>
      )}
    </section>
  );
}
