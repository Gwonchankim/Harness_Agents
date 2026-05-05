import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Harness Agents</h1>
        <p className="max-w-2xl opacity-70">
          Local-first multi-agent workspace. Phase 0 ships scaffolding only — no agents run
          yet. The database schema, default project, and model catalog are wired up so the
          PO Q&A flow, team builder, and Lead DAG planner can land in later phases.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <li className="rounded-lg border border-current/15 p-5">
          <h2 className="text-base font-medium">Settings</h2>
          <p className="mt-1 text-sm opacity-70">
            Inspect the seeded model catalog and verify the database is reachable.
          </p>
          <Link
            href="/settings"
            className="mt-3 inline-block text-sm font-medium underline underline-offset-4"
          >
            Open settings →
          </Link>
        </li>
        <li className="rounded-lg border border-current/15 p-5">
          <h2 className="text-base font-medium">Coming next</h2>
          <p className="mt-1 text-sm opacity-70">
            Prompt input → PO Q&A cards → team builder → Lead DAG → run progress (SSE) →
            result &amp; report &amp; agent reports → feedback &amp; team revision proposals.
          </p>
        </li>
      </ul>
    </section>
  );
}
