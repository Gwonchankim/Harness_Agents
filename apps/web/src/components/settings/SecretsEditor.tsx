'use client';

import { useState, useTransition } from 'react';

import type { SecretInfo, StorageBackend } from '@lib/secrets/store';

interface Props {
  initial: SecretInfo[];
  backend: StorageBackend;
}

const FIELD_LABELS: Record<string, string> = {
  OPENAI_API_KEY: 'OpenAI API key',
  ANTHROPIC_API_KEY: 'Anthropic API key',
  OLLAMA_BASE_URL: 'Ollama base URL',
};

const BACKEND_LABEL: Record<StorageBackend, string> = {
  keytar: 'OS keychain (keytar)',
  'sqlite-aes-gcm': 'SQLite + AES-GCM (local obfuscation)',
  'env-only': 'environment variables only',
};

export function SecretsEditor({ initial, backend }: Props) {
  const [secrets, setSecrets] = useState<SecretInfo[]>(initial);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch('/api/secrets', { cache: 'no-store' });
    if (res.ok) {
      const data: { secrets: SecretInfo[] } = await res.json();
      setSecrets(data.secrets);
    }
  }

  async function save(name: string) {
    const value = (drafts[name] ?? '').trim();
    if (!value) return;
    setMessage(null);
    startTransition(async () => {
      const res = await fetch('/api/secrets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(`Save failed: ${(data as { error?: string }).error ?? res.status}`);
        return;
      }
      setDrafts((prev) => ({ ...prev, [name]: '' }));
      setMessage(`${name} saved`);
      await refresh();
    });
  }

  async function clear(name: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await fetch(`/api/secrets/${encodeURIComponent(name)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        setMessage(`Clear failed: ${res.status}`);
        return;
      }
      setMessage(`${name} cleared`);
      await refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs opacity-70">
        <span>Storage backend:</span>
        <span className="rounded-full border border-current/20 px-2 py-0.5 font-medium">
          {BACKEND_LABEL[backend]}
        </span>
      </div>
      <ul className="divide-y divide-current/10 rounded-lg border border-current/15">
        {secrets.map((secret) => {
          const label = FIELD_LABELS[secret.name] ?? secret.name;
          return (
            <li key={secret.name} className="flex flex-col gap-3 p-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="font-medium">{label}</div>
                  <div className="text-xs opacity-60">{secret.name}</div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      secret.hasValue ? 'bg-emerald-500/15' : 'bg-zinc-500/15'
                    }`}
                  >
                    {secret.hasValue ? 'set' : 'unset'}
                  </span>
                  {secret.hasValue ? (
                    <span className="rounded-full border border-current/20 px-2 py-0.5">
                      {secret.storage}
                    </span>
                  ) : null}
                </div>
              </div>
              {secret.hasValue ? (
                <div className="font-mono text-xs opacity-70">{secret.masked}</div>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={drafts[secret.name] ?? ''}
                  onChange={(e) =>
                    setDrafts((prev) => ({ ...prev, [secret.name]: e.target.value }))
                  }
                  placeholder={
                    secret.name === 'OLLAMA_BASE_URL'
                      ? 'http://localhost:11434/v1'
                      : 'paste new value to update'
                  }
                  className="flex-1 rounded-md border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => save(secret.name)}
                    disabled={busy || !(drafts[secret.name] ?? '').trim()}
                    className="rounded-md border border-current/30 px-3 py-2 text-xs font-medium hover:bg-current/5 disabled:opacity-40"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => clear(secret.name)}
                    disabled={busy || !secret.hasValue || secret.storage === 'env'}
                    className="rounded-md border border-current/20 px-3 py-2 text-xs hover:bg-current/5 disabled:opacity-40"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {message ? <p className="text-xs opacity-70">{message}</p> : null}
    </div>
  );
}
