'use client';

import { useState } from 'react';

import { classifyFailure } from '@lib/runs/failureClass';

interface Props {
  runId: string;
  failedReason: string | null;
  /** Called after an in-place reset so the parent can move the run to `ready`. */
  onReset?: () => void;
  /** Idle button label. Defaults to "Retry run"; set to "Retry from scratch"
   *  when Resume is the primary action so the clone path reads as secondary. */
  actionLabel?: string;
}

interface RetryResponse {
  ok?: boolean;
  mode?: 'reset' | 'clone';
  runId?: string;
  error?: string;
}

export function RetryRunButton({ runId, failedReason, onReset, actionLabel }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const info = classifyFailure(failedReason);

  async function retry() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch(`/api/runs/${runId}/retry`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as RetryResponse;
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      if (data.mode === 'clone' && data.runId) {
        // A fresh run was created (the failed run keeps its history). Load it.
        window.location.assign(`/runs/${data.runId}`);
        return;
      }
      setDone('This run is ready to start again.');
      onReset?.();
      window.location.assign(`/runs/${data.runId ?? runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm">
      <div className="space-y-1">
        <h2 className="text-base font-medium">{info.title || 'Run failed'}</h2>
        <p className="opacity-75">
          {info.help}
          {failedReason ? (
            <code className="ml-1 rounded bg-current/10 px-1 py-0.5">{failedReason}</code>
          ) : null}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={retry}
          disabled={busy}
          className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium hover:bg-current/5 disabled:opacity-40"
        >
          {busy ? 'Retrying...' : (actionLabel ?? 'Retry run')}
        </button>
        {done ? <span className="text-xs text-emerald-700">{done}</span> : null}
        {error ? <span className="text-xs text-rose-600">{error}</span> : null}
      </div>
    </section>
  );
}
