'use client';

import { useState } from 'react';

interface Props {
  runId: string;
  /** Number of already-done tasks whose results will be reused (for copy). */
  doneCount: number;
  /** Called after a successful resume so the parent can re-enter the live stream. */
  onResumed?: () => void;
}

interface ResumeResponse {
  ok?: boolean;
  resetTasks?: number;
  doneReused?: number;
  error?: string;
}

export function ResumeRunButton({ runId, doneCount, onResumed }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resume() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/resume`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as ResumeResponse;
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      onResumed?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
      <div className="space-y-1">
        <h2 className="text-base font-medium">Resume this run</h2>
        <p className="opacity-75">
          {doneCount} completed {doneCount === 1 ? 'step is' : 'steps are'} reused;
          only the failed and not-yet-run steps will execute.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={resume}
          disabled={busy}
          className="rounded-md border border-emerald-600/40 bg-emerald-600/10 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-600/20 disabled:opacity-40"
        >
          {busy ? 'Resuming...' : 'Resume run'}
        </button>
        {error ? <span className="text-xs text-rose-600">{error}</span> : null}
      </div>
    </section>
  );
}
