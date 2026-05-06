'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

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

type ProviderKey = 'openai' | 'anthropic' | 'ollama';

interface ProviderTab {
  key: ProviderKey;
  label: string;
}

const PROVIDER_TABS: readonly ProviderTab[] = [
  { key: 'openai', label: 'OpenAI' },
  { key: 'anthropic', label: 'Anthropic' },
  { key: 'ollama', label: 'Local' },
];

function isProviderKey(value: string): value is ProviderKey {
  return value === 'openai' || value === 'anthropic' || value === 'ollama';
}

function pickProviderModelId(provider: ProviderKey, models: readonly ModelOption[]): string {
  const inProvider = models.filter((m) => m.provider === provider);
  if (inProvider.length === 0) return '';
  return inProvider.find((m) => m.isDefault)?.modelId ?? inProvider[0]!.modelId;
}

function pickInitialProvider(models: readonly ModelOption[]): ProviderKey {
  const defaultModel = models.find((m) => m.isDefault);
  if (defaultModel && isProviderKey(defaultModel.provider)) return defaultModel.provider;
  for (const tab of PROVIDER_TABS) {
    if (models.some((m) => m.provider === tab.key)) return tab.key;
  }
  return 'anthropic';
}

export function NewRunForm({ models }: Props) {
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [provider, setProviderState] = useState<ProviderKey>(() => pickInitialProvider(models));
  const [modelId, setModelId] = useState(() =>
    pickProviderModelId(pickInitialProvider(models), models),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const modelsByProvider = useMemo(() => {
    const map: Record<ProviderKey, ModelOption[]> = {
      openai: [],
      anthropic: [],
      ollama: [],
    };
    for (const m of models) {
      if (isProviderKey(m.provider)) map[m.provider].push(m);
    }
    return map;
  }, [models]);

  const visibleModels = modelsByProvider[provider];

  function changeProvider(next: ProviderKey) {
    setProviderState(next);
    setModelId(pickProviderModelId(next, models));
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (prompt.trim().length === 0) return;
    if (modelId.length === 0) return;
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-sm font-medium">Provider</span>
          <select
            value={provider}
            onChange={(e) => {
              const next = e.target.value;
              if (isProviderKey(next)) changeProvider(next);
            }}
            className="w-full rounded-md border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
          >
            {PROVIDER_TABS.map((tab) => (
              <option key={tab.key} value={tab.key}>
                {tab.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium">PO model</span>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            disabled={visibleModels.length === 0}
            className="w-full rounded-md border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50 disabled:opacity-60"
          >
            {visibleModels.length === 0 ? (
              <option value="">No enabled models</option>
            ) : (
              visibleModels.map((m) => (
                <option key={m.modelId} value={m.modelId}>
                  {m.displayName}
                  {m.isDefault ? ' · default' : ''}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

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
