'use client';

import { useState } from 'react';

interface Props {
  runId: string;
  taskId: string;
  /** Number of transitive dependent steps that will also be re-run (for confirm copy). */
  downstreamCount: number;
  /** Called after a successful re-run trigger so the parent re-enters the live stream. */
  onRerun?: () => void;
}

interface RerunResponse {
  ok?: boolean;
  resetTasks?: number;
  error?: string;
}

export function RerunTaskButton({ runId, taskId, downstreamCount, onRerun }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function rerun() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/tasks/${taskId}/retry`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as RerunResponse;
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      onRerun?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:bg-current/5"
      >
        Re-run from here
      </button>
    );
  }

  const dependents =
    downstreamCount > 0
      ? ` + ${downstreamCount} dependent ${downstreamCount === 1 ? 'step' : 'steps'}`
      : '';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs opacity-75">
        Re-run this step{dependents}? Existing results are replaced.
      </span>
      <button
        type="button"
        onClick={rerun}
        disabled={busy}
        className="rounded-md border border-amber-600/40 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-800 hover:bg-amber-500/20 disabled:opacity-40"
      >
        {busy ? 'Re-running…' : 'Confirm re-run'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="rounded-md border border-current/30 px-2 py-1 text-xs hover:bg-current/5 disabled:opacity-40"
      >
        Cancel
      </button>
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </div>
  );
}
