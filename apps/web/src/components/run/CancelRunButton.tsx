'use client';

import { useState } from 'react';

interface Props {
  runId: string;
  /** Called after a successful cancel so the parent can move to the terminal UI. */
  onCancelled?: () => void;
}

interface CancelResponse {
  ok?: boolean;
  cancelledTasks?: number;
  error?: string;
}

export function CancelRunButton({ runId, onCancelled }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/cancel`, { method: 'POST' });
      const data = (await res.json().catch(() => ({}))) as CancelResponse;
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      onCancelled?.();
      window.location.reload();
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
        className="rounded-md border border-rose-500/40 px-3 py-1.5 text-sm font-medium text-rose-600 hover:bg-rose-500/10"
      >
        Cancel run
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs opacity-75">Stop this run?</span>
      <button
        type="button"
        onClick={cancel}
        disabled={busy}
        className="rounded-md border border-rose-500/50 bg-rose-500/10 px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-500/20 disabled:opacity-40"
      >
        {busy ? 'Cancelling…' : 'Confirm cancel'}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="rounded-md border border-current/30 px-3 py-1.5 text-sm hover:bg-current/5 disabled:opacity-40"
      >
        Keep running
      </button>
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </div>
  );
}
