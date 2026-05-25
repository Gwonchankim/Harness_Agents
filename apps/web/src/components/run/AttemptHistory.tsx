'use client';

// Phase 11/12: per-task attempt history. Collapsible. Phase 12: the list endpoint
// returns METADATA ONLY (no resultText); each attempt's full text is lazy-fetched
// on demand (row "view output" or the diff panel) from attempts/[attemptId].
// Features: source/status client filter, two-dropdown arbitrary compare (default
// latest vs previous), 2,000-char preview + "Show full text", reusing the pure
// diffLines. Degrades to a notice when a task has no attempts (historical run).

import { useState } from 'react';

import { diffLines, type DiffLineType } from '@lib/feedback/diff';
import { resolveComparePair } from '@lib/runs/attemptCompare';
import { truncateForPreview } from '@lib/runs/attemptView';

const PREVIEW_CHARS = 2000;

interface AttemptMeta {
  id: string;
  attemptNumber: number;
  status: string;
  source: string;
  resultBytes: number | null;
  hasResult: boolean;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

interface TextState {
  loading?: boolean;
  text?: string;
  error?: string;
}

const STATUS_STYLE: Record<string, string> = {
  running: 'text-sky-700 dark:text-sky-300',
  done: 'text-emerald-700 dark:text-emerald-300',
  failed: 'text-rose-700 dark:text-rose-300',
  cancelled: 'opacity-60',
};

export function AttemptHistory({ runId, taskId }: { runId: string; taskId: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<AttemptMeta[]>([]);

  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());

  const [texts, setTexts] = useState<Record<string, TextState>>({});
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showFull, setShowFull] = useState<Set<string>>(new Set());

  const [compareOpen, setCompareOpen] = useState(false);
  const [aNum, setANum] = useState<number | null>(null);
  const [bNum, setBNum] = useState<number | null>(null);

  async function loadList() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/tasks/${taskId}/attempts`);
      const data = (await res.json().catch(() => ({}))) as {
        attempts?: AttemptMeta[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setAttempts(data.attempts ?? []);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadText(id: string) {
    if (texts[id]?.text !== undefined || texts[id]?.loading) return;
    setTexts((prev) => ({ ...prev, [id]: { loading: true } }));
    try {
      const res = await fetch(`/api/runs/${runId}/tasks/${taskId}/attempts/${id}`);
      const data = (await res.json().catch(() => ({}))) as {
        attempt?: { resultText?: string | null };
        error?: string;
      };
      if (!res.ok) {
        setTexts((prev) => ({ ...prev, [id]: { error: data.error ?? `HTTP ${res.status}` } }));
        return;
      }
      setTexts((prev) => ({ ...prev, [id]: { text: data.attempt?.resultText ?? '' } }));
    } catch (e) {
      setTexts((prev) => ({ ...prev, [id]: { error: e instanceof Error ? e.message : String(e) } }));
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) void loadList();
  }

  function toggleRow(a: AttemptMeta) {
    if (!a.hasResult) return;
    setExpandedRows((prev) => {
      const n = new Set(prev);
      if (n.has(a.id)) n.delete(a.id);
      else {
        n.add(a.id);
        void loadText(a.id);
      }
      return n;
    });
  }

  function toggleFilter(setter: typeof setSourceFilter, value: string) {
    setter((prev) => {
      const n = new Set(prev);
      if (n.has(value)) n.delete(value);
      else n.add(value);
      return n;
    });
  }

  // Compare pair: explicit dropdown selection, else default latest-vs-previous.
  const pair = resolveComparePair(attempts, aNum, bNum);

  function openCompare() {
    const next = !compareOpen;
    setCompareOpen(next);
    if (next && pair) {
      // Initialize dropdowns to the default pair and load both texts.
      if (aNum == null) setANum(pair.previous.attemptNumber);
      if (bNum == null) setBNum(pair.latest.attemptNumber);
      void loadText(pair.previous.id);
      void loadText(pair.latest.id);
    }
  }

  function selectPair(which: 'a' | 'b', value: number) {
    if (which === 'a') setANum(value);
    else setBNum(value);
    const resolved = resolveComparePair(attempts, which === 'a' ? value : aNum, which === 'b' ? value : bNum);
    if (resolved) {
      void loadText(resolved.previous.id);
      void loadText(resolved.latest.id);
    }
  }

  const sources = ['initial', 'resume', 'rerun_from_task', 'auto_resume'];
  const statuses = ['done', 'failed', 'cancelled', 'running'];
  const visible = attempts.filter(
    (a) =>
      (sourceFilter.size === 0 || sourceFilter.has(a.source)) &&
      (statusFilter.size === 0 || statusFilter.has(a.status)),
  );

  const prevText = pair ? texts[pair.previous.id]?.text : undefined;
  const latestText = pair ? texts[pair.latest.id]?.text : undefined;
  const pairTextError = pair
    ? (texts[pair.previous.id]?.error ?? texts[pair.latest.id]?.error ?? null)
    : null;
  const diff =
    pair && prevText !== undefined && latestText !== undefined
      ? diffLines(prevText, latestText)
      : null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        className="rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:bg-current/5"
      >
        {open ? '▾' : '▸'} Attempt history{loaded ? ` (${attempts.length})` : ''}
      </button>
      {open ? (
        <div className="mt-2 space-y-3">
          {loading ? <p className="text-xs opacity-70">Loading…</p> : null}
          {error ? <p className="text-xs text-rose-600">{error}</p> : null}
          {loaded && attempts.length === 0 ? (
            <p className="text-xs opacity-70">attempt 기록 없음 / 이전 버전 run</p>
          ) : null}

          {attempts.length > 0 ? (
            <>
              {/* Filters (client-side over the loaded metadata) */}
              <div className="flex flex-wrap items-center gap-1 text-xs">
                <span className="opacity-50">source:</span>
                {sources.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleFilter(setSourceFilter, s)}
                    className={`rounded border px-1.5 py-0.5 ${sourceFilter.has(s) ? 'border-current/60 bg-current/10' : 'border-current/20 opacity-60'}`}
                  >
                    {s}
                  </button>
                ))}
                <span className="ml-2 opacity-50">status:</span>
                {statuses.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleFilter(setStatusFilter, s)}
                    className={`rounded border px-1.5 py-0.5 ${statusFilter.has(s) ? 'border-current/60 bg-current/10' : 'border-current/20 opacity-60'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>

              {/* Timeline */}
              <ol className="space-y-1 text-xs">
                {visible.map((a) => {
                  const t = texts[a.id];
                  const expanded = expandedRows.has(a.id);
                  return (
                    <li key={a.id} className="rounded border border-current/15 p-2">
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                        <span className="font-mono opacity-70">#{a.attemptNumber}</span>
                        <span className={`uppercase tracking-wide ${STATUS_STYLE[a.status] ?? ''}`}>
                          {a.status}
                        </span>
                        <span className="opacity-70">{a.source}</span>
                        {a.durationMs != null ? <span className="opacity-60">{a.durationMs} ms</span> : null}
                        {a.resultBytes != null ? <span className="opacity-60">{a.resultBytes} B</span> : null}
                        {a.startedAt ? (
                          <span className="opacity-50">{new Date(a.startedAt).toLocaleString()}</span>
                        ) : null}
                        {a.error ? <span className="text-rose-600">{a.error}</span> : null}
                        {a.hasResult ? (
                          <button
                            type="button"
                            onClick={() => toggleRow(a)}
                            className="ml-auto rounded border border-current/30 px-1.5 py-0.5 hover:bg-current/5"
                          >
                            {expanded ? 'hide output' : 'view output'}
                          </button>
                        ) : null}
                      </div>
                      {expanded ? (
                        <div className="mt-1">
                          {t?.loading ? <span className="opacity-60">Loading…</span> : null}
                          {t?.error ? <span className="text-rose-600">{t.error}</span> : null}
                          {t?.text !== undefined ? (
                            <OutputView
                              id={a.id}
                              text={t.text}
                              showFull={showFull.has(a.id)}
                              onToggleFull={() =>
                                setShowFull((prev) => {
                                  const n = new Set(prev);
                                  if (n.has(a.id)) n.delete(a.id);
                                  else n.add(a.id);
                                  return n;
                                })
                              }
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ol>

              {/* Compare */}
              <div>
                <button
                  type="button"
                  onClick={openCompare}
                  className="rounded-md border border-current/30 px-2 py-1 text-xs font-medium hover:bg-current/5"
                  disabled={!pair && aNum == null}
                >
                  {compareOpen ? '▾' : '▸'} Compare attempts
                </button>
                {compareOpen ? (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <label className="flex items-center gap-1">
                        A
                        <select
                          value={aNum ?? ''}
                          onChange={(e) => selectPair('a', Number(e.target.value))}
                          className="rounded border border-current/30 bg-transparent px-1 py-0.5"
                        >
                          <option value="" disabled>
                            —
                          </option>
                          {attempts.map((a) => (
                            <option key={a.id} value={a.attemptNumber}>
                              #{a.attemptNumber} ({a.status})
                            </option>
                          ))}
                        </select>
                      </label>
                      <span className="opacity-50">→</span>
                      <label className="flex items-center gap-1">
                        B
                        <select
                          value={bNum ?? ''}
                          onChange={(e) => selectPair('b', Number(e.target.value))}
                          className="rounded border border-current/30 bg-transparent px-1 py-0.5"
                        >
                          <option value="" disabled>
                            —
                          </option>
                          {attempts.map((a) => (
                            <option key={a.id} value={a.attemptNumber}>
                              #{a.attemptNumber} ({a.status})
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {!pair ? (
                      <p className="text-xs opacity-60">비교할 attempt가 2개 이상 필요합니다.</p>
                    ) : pairTextError ? (
                      <p className="text-xs text-rose-600">{pairTextError}</p>
                    ) : diff ? (
                      <div>
                        <div className="mb-1 text-xs opacity-70">
                          Diff: #{pair.previous.attemptNumber} → #{pair.latest.attemptNumber}
                        </div>
                        <div className="max-h-[28rem] overflow-auto rounded-md border border-current/15 font-mono text-xs leading-5">
                          {diff.map((line, i) => (
                            <div key={i} className={lineClass(line.type)}>
                              <span className="select-none opacity-50">{prefix(line.type)} </span>
                              {line.text || ' '}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs opacity-60">Loading diff…</p>
                    )}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OutputView({
  id,
  text,
  showFull,
  onToggleFull,
}: {
  id: string;
  text: string;
  showFull: boolean;
  onToggleFull: () => void;
}) {
  void id;
  const { preview, truncated, totalChars } = truncateForPreview(text, PREVIEW_CHARS);
  const shown = showFull ? text : preview;
  return (
    <div className="space-y-1">
      <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border border-current/15 p-2 text-xs">
        {shown || ' '}
      </pre>
      {truncated ? (
        <button
          type="button"
          onClick={onToggleFull}
          className="rounded border border-current/30 px-1.5 py-0.5 text-xs hover:bg-current/5"
        >
          {showFull ? 'Show less' : `Show full text (${totalChars} chars)`}
        </button>
      ) : null}
    </div>
  );
}

function prefix(t: DiffLineType): string {
  return t === 'add' ? '+' : t === 'del' ? '-' : ' ';
}

function lineClass(t: DiffLineType): string {
  const base = 'whitespace-pre-wrap px-2';
  if (t === 'add') return `${base} bg-emerald-500/10 text-emerald-800 dark:text-emerald-300`;
  if (t === 'del') return `${base} bg-rose-500/10 text-rose-800 dark:text-rose-300`;
  return `${base} opacity-70`;
}
