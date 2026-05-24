'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface StartRunButtonProps {
  runId: string;
  label?: string;
  className?: string;
}

export function StartRunButton({
  runId,
  label = 'Start run →',
  className,
}: StartRunButtonProps) {
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startRun() {
    setStarting(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/start`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          status?: string;
        };
        if (res.status === 409 && body.error === 'run_not_startable' && body.status) {
          router.push(`/runs/${runId}` as never);
          return;
        }
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      router.push(`/runs/${runId}` as never);
    } finally {
      setStarting(false);
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        disabled={starting}
        onClick={startRun}
        className={
          className ??
          'inline-block rounded-md border border-current/30 px-3 py-1 text-xs font-medium hover:bg-current/5 disabled:opacity-40'
        }
      >
        {starting ? 'Starting run...' : label}
      </button>
      {error ? <span className="text-xs text-rose-600">{error}</span> : null}
    </span>
  );
}
