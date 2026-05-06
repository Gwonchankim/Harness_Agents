'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ALLOWED_TOOL_NAMES } from '@lib/tools/policy';

import { RevisionDiffViewer } from './RevisionDiffViewer';

interface ModelCatalogClient {
  modelId: string;
  displayName: string;
  provider: string;
  costTier: string;
  speedTier: string;
  isDefault: boolean;
}

interface RecalledTeamSummary {
  teamId: string;
  name: string;
  description: string | null;
  domain: string | null;
  tags: string[];
  leadAgentName: string | null;
  agentCount: number;
  score: {
    keywordScore: number;
    tagScore: number;
    domainScore: number;
    historyScore: number;
    total: number;
  };
}

interface ProposedAgent {
  name: string;
  role: string;
  isLead: boolean;
  systemPrompt: string;
  modelId: string;
  modelHint: 'fast' | 'standard' | 'premium' | 'local';
  provider: 'openai' | 'anthropic' | 'ollama';
  toolsAllowed: string[];
  tags: string[];
}

interface Proposal {
  name: string;
  description?: string;
  domain?: string;
  tags: string[];
  agents: ProposedAgent[];
}

interface RecommendResponse {
  recalled: RecalledTeamSummary[];
  proposal: Proposal;
  modelCatalog: ModelCatalogClient[];
}

interface Props {
  sessionId: string;
}

const TOOL_OPTIONS = [...ALLOWED_TOOL_NAMES];

export function TeamComposer({ sessionId }: Props) {
  const router = useRouter();
  const [data, setData] = useState<RecommendResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editable, setEditable] = useState<Proposal | null>(null);
  const [exportErrors, setExportErrors] = useState<
    Array<{ path: string; message: string }> | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/teams/recommend', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (!cancelled) {
            setError((body as { error?: string }).error ?? `HTTP ${res.status}`);
          }
          return;
        }
        const body = (await res.json()) as RecommendResponse;
        if (!cancelled) {
          setData(body);
          setEditable({ ...body.proposal, agents: body.proposal.agents.map((a) => ({ ...a })) });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const previewMd = useMemo(() => {
    if (!editable) return '';
    return `# ${editable.name}\n\n${editable.description ?? ''}\n\n${editable.agents
      .map(
        (a, i) =>
          `## ${i + 1}. ${a.name}${a.isLead ? ' (Lead)' : ''}\nRole: ${a.role}\nModel: ${a.modelId}\nTools: ${a.toolsAllowed.join(', ') || 'none'}`,
      )
      .join('\n\n')}`;
  }, [editable]);

  function updateAgent(index: number, patch: Partial<ProposedAgent>) {
    setEditable((prev) => {
      if (!prev) return prev;
      const agents = prev.agents.map((a, i) => (i === index ? { ...a, ...patch } : a));
      return { ...prev, agents };
    });
  }

  function setLead(index: number) {
    setEditable((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        agents: prev.agents.map((a, i) => ({ ...a, isLead: i === index })),
      };
    });
  }

  function toggleTool(index: number, tool: string) {
    setEditable((prev) => {
      if (!prev) return prev;
      const agents = prev.agents.map((a, i) => {
        if (i !== index) return a;
        const has = a.toolsAllowed.includes(tool);
        return {
          ...a,
          toolsAllowed: has ? a.toolsAllowed.filter((t) => t !== tool) : [...a.toolsAllowed, tool],
        };
      });
      return { ...prev, agents };
    });
  }

  async function confirmRecalled(teamId: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, choice: 'recalled', recalledTeamId: teamId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as { runId: string };
      router.push(`/runs/${body.runId}` as never);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmNew() {
    if (!editable) return;
    setSubmitting(true);
    setError(null);
    setExportErrors(null);
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, choice: 'new', proposal: editable }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError((body as { error?: string }).error ?? `HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as {
        runId: string;
        exportErrors?: Array<{ path: string; message: string }>;
      };
      if (body.exportErrors && body.exportErrors.length > 0) {
        setExportErrors(body.exportErrors);
      }
      router.push(`/runs/${body.runId}` as never);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <p className="text-sm opacity-70">Building team recommendations…</p>;
  }
  if (error || !data || !editable) {
    return (
      <div className="space-y-3 text-sm">
        <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-rose-700 dark:text-rose-300">
          Could not load recommendations: {error ?? 'unknown error'}
        </p>
        <button
          type="button"
          onClick={() => location.reload()}
          className="rounded-md border border-current/30 px-3 py-1 text-xs hover:bg-current/5"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          Recalled teams
        </h2>
        {data.recalled.length === 0 ? (
          <p className="rounded-md border border-current/15 p-4 text-sm opacity-70">
            No recalled teams yet — review the proposed team below.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {data.recalled.map((t) => (
              <li
                key={t.teamId}
                className="flex flex-col gap-2 rounded-lg border border-current/15 p-4 text-sm"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="text-xs opacity-60">
                    score {t.score.total.toFixed(2)}
                  </span>
                </div>
                {t.description ? (
                  <p className="text-xs opacity-70">{t.description}</p>
                ) : null}
                <div className="text-xs opacity-60">
                  {t.agentCount} agents · lead {t.leadAgentName ?? '—'}
                </div>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => confirmRecalled(t.teamId)}
                  className="self-start rounded-md border border-current/30 px-3 py-1 text-xs font-medium hover:bg-current/5 disabled:opacity-40"
                >
                  Use this team
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
            Proposed team
          </h2>
          <span className="text-xs opacity-60">{editable.agents.length} agents</span>
        </div>

        <div className="space-y-2">
          <label className="text-xs opacity-70">Name</label>
          <input
            type="text"
            value={editable.name}
            onChange={(e) => setEditable({ ...editable, name: e.target.value })}
            className="w-full rounded-md border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs opacity-70">Description</label>
          <textarea
            rows={2}
            value={editable.description ?? ''}
            onChange={(e) => setEditable({ ...editable, description: e.target.value })}
            className="w-full resize-y rounded-md border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50"
          />
        </div>

        <ul className="space-y-4">
          {editable.agents.map((a, i) => (
            <li
              key={i}
              className="space-y-3 rounded-lg border border-current/15 p-4 text-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <input
                  type="text"
                  value={a.name}
                  onChange={(e) => updateAgent(i, { name: e.target.value })}
                  className="flex-1 rounded-md border border-current/20 bg-transparent px-2 py-1 text-sm font-medium outline-none focus:border-current/50"
                />
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="radio"
                    name="lead"
                    checked={a.isLead}
                    onChange={() => setLead(i)}
                  />
                  Lead
                </label>
              </div>
              <div className="space-y-1">
                <label className="text-xs opacity-70">Role</label>
                <input
                  type="text"
                  value={a.role}
                  onChange={(e) => updateAgent(i, { role: e.target.value })}
                  className="w-full rounded-md border border-current/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-current/50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs opacity-70">Model</label>
                <select
                  value={a.modelId}
                  onChange={(e) => updateAgent(i, { modelId: e.target.value })}
                  className="w-full rounded-md border border-current/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-current/50"
                >
                  {data.modelCatalog.map((m) => (
                    <option key={m.modelId} value={m.modelId}>
                      {m.displayName} · {m.provider}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] opacity-60">hint: {a.modelHint}</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs opacity-70">System prompt</label>
                <textarea
                  rows={4}
                  value={a.systemPrompt}
                  onChange={(e) => updateAgent(i, { systemPrompt: e.target.value })}
                  className="w-full resize-y rounded-md border border-current/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-current/50"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs opacity-70">Tools allowed</label>
                <div className="flex flex-wrap gap-2">
                  {TOOL_OPTIONS.map((tool) => (
                    <label
                      key={tool}
                      className="flex items-center gap-2 rounded-full border border-current/20 px-2 py-0.5 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={a.toolsAllowed.includes(tool)}
                        onChange={() => toggleTool(i, tool)}
                      />
                      {tool}
                    </label>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="space-y-3">
          <h3 className="text-xs font-medium uppercase tracking-wide opacity-60">
            AGENTS.md preview
          </h3>
          <RevisionDiffViewer agentsMd={previewMd} />
        </div>

        {exportErrors ? (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            <strong>Team saved.</strong> Some workspace files failed to write:
            <ul className="mt-1 list-disc pl-5">
              {exportErrors.map((e) => (
                <li key={e.path}>
                  {e.path}: {e.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          disabled={submitting}
          onClick={confirmNew}
          className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium hover:bg-current/5 disabled:opacity-40"
        >
          {submitting ? 'Saving…' : 'Confirm and create team'}
        </button>
      </section>
    </div>
  );
}
