import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Harness Agents</h1>
        <p className="max-w-2xl opacity-70">
          Local-first multi-agent workspace. Phase 1 wires up the agent runtime
          foundation: provider keys (with masked storage), the seeded model catalog,
          per-provider availability checks, and the settings editor. The PO Q&A flow,
          team builder, and Lead DAG planner land in later phases.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
