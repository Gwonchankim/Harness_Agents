'use client';

import { useEffect, useState } from 'react';

interface AvailabilityResult {
  available: boolean;
  reason?: string;
  latencyMs?: number;
  checkedAt: string;
}

interface ModelsResponse {
  models: Array<{ provider: string; modelId: string }>;
  availability: Record<string, AvailabilityResult>;
}

export function AvailabilityBadges() {
  const [data, setData] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/models', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as ModelsResponse;
        if (!cancelled) setData(body);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <p className="text-xs text-rose-500">availability check failed: {error}</p>;
  }
  if (!data) {
    return <p className="text-xs opacity-60">checking provider availability…</p>;
  }
  const providers = Object.entries(data.availability);
  if (providers.length === 0) {
    return <p className="text-xs opacity-60">no enabled models</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2 text-xs">
      {providers.map(([provider, result]) => (
        <li
          key={provider}
          title={result.reason ?? (result.latencyMs ? `${result.latencyMs} ms` : '')}
          className={`rounded-full px-2 py-0.5 ${
            result.available
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
          }`}
        >
          {provider}: {result.available ? 'available' : 'unavailable'}
        </li>
      ))}
    </ul>
  );
}
