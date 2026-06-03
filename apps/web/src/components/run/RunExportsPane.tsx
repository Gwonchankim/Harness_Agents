'use client';

// Phase 15/16: Exports panel — lets users discover/inspect/download a run's
// exported files. Rows are split into Run outputs (result.md / report.md /
// agent-reports/*) and Team files (AGENTS.md / team.json). The metadata list is
// passed in (latest per kind/path, deduped server-side); each file's text is
// lazy-fetched on demand with a preview cap, and the raw bytes stream from a
// separate download route. A per-row history toggle lazy-loads the append-only
// creation history (metadata only). No markdown renderer — preview is plain text.

import { useState } from 'react';

import { summarizeRedundancy } from '@lib/results/artifactStats';

export interface ArtifactMeta {
  id: string;
  kind: string;
  path: string;
  bytes: number;
  createdAt: string; // ISO
  // Phase 18 (additive): append-only version stats for this (kind, path) group.
  versionCount?: number;
  redundantCount?: number;
  sameContentCount?: number;
  changedVersionCount?: number;
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
  totalBytes?: number;
  error?: string;
}

interface ArtifactVersion {
  id: string;
  bytes: number;
  sha256: string | null;
  createdAt: string;
  latest: boolean;
}

interface HistoryState {
  loading?: boolean;
  versions?: ArtifactVersion[];
  error?: string;
}

interface DownloadState {
  loading?: boolean;
  error?: string;
}

const KIND_LABELS: Record<string, string> = {
  result_md: 'Deliverable',
  report_md: 'Run report',
  agent_report_md: 'Agent report',
  team_md: 'Team agents',
  team_json: 'Team JSON',
};

// Run outputs vs Team files. Anything not a run output is shown under Team files.
const RUN_OUTPUT_KINDS = new Set(['result_md', 'report_md', 'agent_report_md']);

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
  const [historyOpen, setHistoryOpen] = useState<Set<string>>(new Set());
  const [histories, setHistories] = useState<Record<string, HistoryState>>({});
  const [downloads, setDownloads] = useState<Record<string, DownloadState>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (artifacts.length === 0) return null;

  const agentNameById = new Map(agents.map((x) => [x.id, x.name] as const));
  const runOutputs = artifacts.filter((a) => RUN_OUTPUT_KINDS.has(a.kind));
  const teamFiles = artifacts.filter((a) => !RUN_OUTPUT_KINDS.has(a.kind));
  // Phase 18: non-destructive redundancy overview from the metadata already in props.
  const redundancy = summarizeRedundancy(artifacts);

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
        totalBytes?: number;
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
          totalBytes: data.totalBytes,
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

  async function loadHistory(a: ArtifactMeta) {
    if (histories[a.id]?.versions !== undefined || histories[a.id]?.loading) return;
    setHistories((prev) => ({ ...prev, [a.id]: { loading: true } }));
    try {
      const qs = new URLSearchParams({ kind: a.kind, path: a.path });
      const res = await fetch(`/api/runs/${runId}/artifacts/history?${qs.toString()}`, {
        cache: 'no-store',
      });
      const data = (await res.json().catch(() => ({}))) as {
        versions?: ArtifactVersion[];
        error?: string;
      };
      if (!res.ok) {
        setHistories((prev) => ({ ...prev, [a.id]: { error: data.error ?? `HTTP ${res.status}` } }));
        return;
      }
      setHistories((prev) => ({ ...prev, [a.id]: { versions: data.versions ?? [] } }));
    } catch (e) {
      setHistories((prev) => ({
        ...prev,
        [a.id]: { error: e instanceof Error ? e.message : String(e) },
      }));
    }
  }

  function toggleHistory(a: ArtifactMeta) {
    const willExpand = !historyOpen.has(a.id);
    setHistoryOpen((prev) => {
      const n = new Set(prev);
      if (n.has(a.id)) n.delete(a.id);
      else n.add(a.id);
      return n;
    });
    if (willExpand) void loadHistory(a);
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

  // Fetch-based download so a missing-file 404 (JSON) surfaces as an inline row
  // error instead of opening in a throwaway tab. On success the blob is saved via
  // a transient object URL that is revoked immediately after the click.
  async function downloadFile(a: ArtifactMeta) {
    if (downloads[a.id]?.loading) return;
    setDownloads((prev) => ({ ...prev, [a.id]: { loading: true } }));
    try {
      const res = await fetch(`/api/runs/${runId}/artifacts/${a.id}/download`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setDownloads((prev) => ({
          ...prev,
          [a.id]: { error: data.error ?? `HTTP ${res.status}` },
        }));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      try {
        const el = document.createElement('a');
        el.href = url;
        el.download = rowName(a, agentNameById);
        document.body.appendChild(el);
        el.click();
        el.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
      // Clear transient state on success.
      setDownloads((prev) => {
        const n = { ...prev };
        delete n[a.id];
        return n;
      });
    } catch (e) {
      setDownloads((prev) => ({
        ...prev,
        [a.id]: { error: e instanceof Error ? e.message : String(e) },
      }));
    }
  }

  function renderRow(a: ArtifactMeta) {
    const c = contents[a.id];
    const isExpanded = expanded.has(a.id);
    const isHistoryOpen = historyOpen.has(a.id);
    const h = histories[a.id];
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
              onClick={() => downloadFile(a)}
              disabled={downloads[a.id]?.loading}
              className="rounded border border-current/30 px-1.5 py-0.5 hover:bg-current/5 disabled:opacity-50"
            >
              {downloads[a.id]?.loading ? 'downloading…' : 'download'}
            </button>
            <button
              type="button"
              onClick={() => copyPath(a.id, a.path)}
              className="rounded border border-current/30 px-1.5 py-0.5 hover:bg-current/5"
            >
              {copiedId === a.id ? 'copied' : 'copy path'}
            </button>
            <button
              type="button"
              onClick={() => toggleHistory(a)}
              className="rounded border border-current/30 px-1.5 py-0.5 hover:bg-current/5"
            >
              {isHistoryOpen ? 'hide history' : 'history'}
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
        {a.versionCount != null && a.versionCount > 1 ? (
          <div className="mt-0.5 opacity-50">
            {a.versionCount} versions · {a.redundantCount ?? a.versionCount - 1} redundant (metadata only)
            {a.sameContentCount != null && a.sameContentCount > 0
              ? ` · ${a.sameContentCount} same content`
              : ''}
          </div>
        ) : null}
        {downloads[a.id]?.error ? (
          <div className="mt-1 text-rose-600">Download failed: {downloads[a.id]?.error}</div>
        ) : null}
        {isHistoryOpen ? (
          <div className="mt-1 rounded-md border border-current/15 p-2">
            {h?.loading ? <span className="opacity-60">Loading history…</span> : null}
            {h?.error ? <span className="text-rose-600">{h.error}</span> : null}
            {h?.versions !== undefined ? (
              <div className="space-y-1">
                <p className="opacity-60">
                  Creation history (newest first). Each re-export appends a record; only the latest
                  version&apos;s file is kept on disk, so past versions are metadata only — their
                  content is not recoverable, and preview/download always show the current file.
                </p>
                <ul className="space-y-0.5">
                  {h.versions.map((v) => (
                    <li key={v.id} className="flex flex-wrap items-baseline gap-x-3">
                      <span className="opacity-50">{new Date(v.createdAt).toLocaleString()}</span>
                      <span className="opacity-60">{formatBytes(v.bytes)}</span>
                      <span className="font-mono opacity-50">
                        {v.sha256 ? v.sha256.slice(0, 12) : '—'}
                      </span>
                      {v.latest ? (
                        <span className="rounded border border-current/30 px-1 opacity-70">latest</span>
                      ) : (
                        <span className="opacity-50">metadata only</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
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
                    Preview truncated
                    {c.totalBytes != null
                      ? ` (${formatBytes(c.totalBytes)} total)`
                      : c.totalChars != null
                        ? ` (${c.totalChars} chars total)`
                        : ''}
                    . Open the file at the path above to read the rest.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </li>
    );
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
        <div className="space-y-3 text-xs">
          <div className="uppercase tracking-wide opacity-50">
            {redundancy.groups} files · {redundancy.totalVersions} versions · {redundancy.redundant}{' '}
            redundant ({redundancy.redundancyPct}%)
          </div>
          {runOutputs.length > 0 ? (
            <div className="space-y-1">
              <div className="uppercase tracking-wide opacity-50">Run outputs</div>
              <ul className="space-y-1">{runOutputs.map(renderRow)}</ul>
            </div>
          ) : null}
          {teamFiles.length > 0 ? (
            <div className="space-y-1">
              <div className="uppercase tracking-wide opacity-50">Team files</div>
              <ul className="space-y-1">{teamFiles.map(renderRow)}</ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
