'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface ModelOption {
  modelId: string;
  displayName: string;
  provider: string;
  recommendedUse: string | null;
  isDefault: boolean;
}

interface Props {
  models: ModelOption[];
}

export function NewRunForm({ models }: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [modelId, setModelId] = useState(
    models.find((m) => m.isDefault)?.modelId ?? models[0]?.modelId ?? '',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (prompt.trim().length === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, modelId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { sessionId: string };
      router.push(`/runs/new/${data.sessionId}` as never);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block space-y-2">
        <span className="text-sm font-medium">What do you want the team to work on?</span>
        <textarea
          required
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the request in plain language. The PO Agent will ask 5–6 clarification questions next."
          className="w-full resize-y rounded-md border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
        />
      </label>

      <label className="block space-y-2">
        <span className="text-sm font-medium">PO model</span>
        <select
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          className="w-full rounded-md border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
        >
          {models.length === 0 ? (
            <option value="">No enabled models — seed catalog first</option>
          ) : (
            models.map((m) => (
              <option key={m.modelId} value={m.modelId}>
                {m.displayName} · {m.provider}
                {m.isDefault ? ' · default' : ''}
              </option>
            ))
          )}
        </select>
      </label>

      {error ? <p className="text-xs text-rose-500">Could not start: {error}</p> : null}

      <button
        type="submit"
        disabled={busy || prompt.trim().length === 0 || modelId.length === 0}
        className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium hover:bg-current/5 disabled:opacity-40"
      >
        {busy ? 'Starting…' : 'Start PO Q&A'}
      </button>
    </form>
  );
}
