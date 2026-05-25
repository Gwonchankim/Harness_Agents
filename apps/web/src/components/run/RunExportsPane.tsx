'use client';

// Phase 15: Exports panel — lets users discover/inspect a run's exported files
// (result.md / report.md / agent-reports/*). The metadata list is passed in
// (latest per kind/path, deduped server-side); each file's text is lazy-fetched
// on demand from artifacts/[artifactId] with a preview cap. A row whose file is
// missing on disk degrades to a notice. No markdown renderer / download here.

import { useState } from 'react';

export interface ArtifactMeta {
  id: string;
  kind: string;
  path: string;
  bytes: number;
  createdAt: string; // ISO
}

export interface ExportsAgent {
  id: string;
  name: string;
}

interface ContentState {
  loading?: boolean;
  content?: string;
  missing?: boolean;
  truncated?: boolean;
  totalChars?: number;
  error?: string;
}

const KIND_LABELS: Record<string, string> = {
  result_md: 'Deliverable',
  report_md: 'Run report',
  agent_report_md: 'Agent report',
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

// Display label for a row. agent-reports are stored as `agent-reports/{agentId}.md`;
// map the agentId to the agent's name when possible, falling back to the filename.
function rowName(a: ArtifactMeta, agentNameById: Map<string, string>): string {
  if (a.kind === 'agent_report_md') {
    const agentId = basename(a.path).replace(/\.md$/i, '');
    const name = agentNameById.get(agentId);
    if (name) return `${name}.md`;
  }
  return basename(a.path);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function RunExportsPane({
  runId,
  artifacts,
  agents,
}: {
  runId: string;
  artifacts: ArtifactMeta[];
  agents: ExportsAgent[];
}) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [contents, setContents] = useState<Record<string, ContentState>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (artifacts.length === 0) return null;

  const agentNameById = new Map(agents.map((x) => [x.id, x.name] as const));

  async function loadContent(id: string) {
    if (contents[id]?.content !== undefined || contents[id]?.missing || contents[id]?.loading) {
      return;
    }
    setContents((prev) => ({ ...prev, [id]: { loading: true } }));
    try {
      const res = await fetch(`/api/runs/${runId}/artifacts/${id}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as {
        content?: string;
        missing?: boolean;
        truncated?: boolean;
        totalChars?: number;
        error?: string;
      };
      if (!res.ok) {
        setContents((prev) => ({ ...prev, [id]: { error: data.error ?? `HTTP ${res.status}` } }));
        return;
      }
      if (data.missing) {
        setContents((prev) => ({ ...prev, [id]: { missing: true } }));
        return;
      }
      setContents((prev) => ({
        ...prev,
        [id]: {
          content: data.content ?? '',
          truncated: data.truncated ?? false,
          totalChars: data.totalChars,
        },
      }));
    } catch (e) {
      setContents((prev) => ({
        ...prev,
        [id]: { error: e instanceof Error ? e.message : String(e) },
      }));
    }
  }

  function toggleRow(id: string) {
    // Decide expand/collapse from current state, then mutate state in a pure
    // updater and fire the lazy fetch OUTSIDE it (updaters must be side-effect
    // free; otherwise React StrictMode double-invokes and double-fetches).
    const willExpand = !expanded.has(id);
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
    if (willExpand) void loadContent(id);
  }

  async function copyPath(id: string, path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      /* clipboard unavailable; ignore */
    }
  }

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm font-medium uppercase tracking-wide opacity-60 hover:opacity-100"
      >
        {open ? '▾' : '▸'} Exports ({artifacts.length})
      </button>

      {open ? (
        <ul className="space-y-1 text-xs">
          {artifacts.map((a) => {
            const c = contents[a.id];
            const isExpanded = expanded.has(a.id);
            return (
              <li key={a.id} className="rounded border border-current/15 p-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="uppercase tracking-wide opacity-60">{kindLabel(a.kind)}</span>
                  <span className="font-mono">{rowName(a, agentNameById)}</span>
                  <span className="opacity-60">{formatBytes(a.bytes)}</span>
                  <span className="opacity-50">{new Date(a.createdAt).toLocaleString()}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyPath(a.id, a.path)}
                      className="rounded border border-current/30 px-1.5 py-0.5 hover:bg-current/5"
                    >
                      {copiedId === a.id ? 'copied' : 'copy path'}
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleRow(a.id)}
                      className="rounded border border-current/30 px-1.5 py-0.5 hover:bg-current/5"
                    >
                      {isExpanded ? 'hide' : 'view'}
                    </button>
                  </span>
                </div>
                <div className="mt-1 font-mono opacity-50">{a.path}</div>
                {isExpanded ? (
                  <div className="mt-1">
                    {c?.loading ? <span className="opacity-60">Loading…</span> : null}
                    {c?.error ? <span className="text-rose-600">{c.error}</span> : null}
                    {c?.missing ? (
                      <span className="text-amber-700">
                        File not found on disk (the export record exists, but the file is missing).
                      </span>
                    ) : null}
                    {c?.content !== undefined ? (
                      <div className="space-y-1">
                        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border border-current/15 p-2">
                          {c.content || ' '}
                        </pre>
                        {c.truncated ? (
                          <p className="opacity-60">
                            Preview truncated{c.totalChars != null ? ` (${c.totalChars} chars total)` : ''}. Open
                            the file at the path above to read the rest.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
