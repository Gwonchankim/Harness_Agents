import Link from 'next/link';

export default function HomePage() {
  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Harness Agents</h1>
        <p className="max-w-2xl opacity-70">
          Local-first multi-agent workspace. Phase 4 wires the DAG executor: once a Team is
          confirmed, the Lead Agent generates an ExecutionPlan, the executor runs each task
          sequentially, and a per-run page streams events over SSE (with polling fallback).
          Tasks, RunEvents, and a <code>plan.md</code> artifact are persisted; final
          <code className="mx-1">result.md</code> / <code>report.md</code> synthesis lands in Phase 5.
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
