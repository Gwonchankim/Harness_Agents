import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Harness Agents</h1>
        <p className="max-w-2xl opacity-70">
          Local-first multi-agent workspace. Phase 3 adds team composition: after the PO
          Q&A completes, the Team Architect proposes a 5-agent team (1 lead) that you can
          edit and confirm. Confirming creates the Team, Agents, TeamRevision v1, exports
          AGENTS.md + team.json under <code>projects/.../teams/</code>, and marks the run
          ready for execution. DAG execution and reports land in later phases.
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
          <h2 className="text-base font-medium">Start a new run</h2>
          <p className="mt-1 text-sm opacity-70">
            Enter a prompt, pick a PO model, and walk through 5–6 dynamic
            clarification cards. Auto-judge or custom answers supported.
          </p>
          <Link
            href="/runs/new"
            className="mt-3 inline-block text-sm font-medium underline underline-offset-4"
          >
            New run →
          </Link>
        </li>
      </ul>
    </section>
  );
}
