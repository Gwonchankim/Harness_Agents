'use client';

// Phase 11: per-task attempt history. Collapsible; fetches TaskAttempt rows on
// demand from the attempts endpoint and shows a timeline + the latest-vs-previous
// resultText diff (reusing the pure lib/feedback/diff.ts). Degrades to a notice
// when a task has no attempts (pre-Phase-11 / historical run).

import { useState } from 'react';

import { diffLines, type DiffLineType } from '@lib/feedback/diff';
import { selectComparison } from '@lib/runs/attemptCompare';

interface Attempt {
  id: string;
  attemptNumber: number;
  status: string;
  source: string;
  resultText: string | null;
  resultBytes: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  running: 'text-sky-700 dark:text-sky-300',
  done: 'text-emerald-700 dark:text-emerald-300',
  failed: 'text-rose-700 dark:text-rose-300',
  cancelled: 'opacity-60',
};

function durationMs(a: Attempt): number | null {
  if (!a.startedAt || !a.completedAt) return null;
  return new Date(a.completedAt).getTime() - new Date(a.startedAt).getTime();
}

export function AttemptHistory({ runId, taskId }: { runId: string; taskId: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded && !loading) {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/runs/${runId}/tasks/${taskId}/attempts`);
        const data = (await res.json().catch(() => ({}))) as {
          attempts?: Attempt[];
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
  }

  const comparison = selectComparison(attempts);
  const diff = comparison
    ? diffLines(comparison.previous.resultText ?? '', comparison.latest.resultText ?? '')
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
            <ol className="space-y-1 text-xs">
              {attempts.map((a) => {
                const d = durationMs(a);
                return (
                  <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <span className="font-mono opacity-70">#{a.attemptNumber}</span>
                    <span className={`uppercase tracking-wide ${STATUS_STYLE[a.status] ?? ''}`}>
                      {a.status}
                    </span>
                    <span className="opacity-70">{a.source}</span>
                    {d != null ? <span className="opacity-60">{d} ms</span> : null}
                    {a.resultBytes != null ? (
                      <span className="opacity-60">{a.resultBytes} B</span>
                    ) : null}
                    {a.startedAt ? (
                      <span className="opacity-50">{new Date(a.startedAt).toLocaleString()}</span>
                    ) : null}
                    {a.error ? <span className="text-rose-600">{a.error}</span> : null}
                  </li>
                );
              })}
            </ol>
          ) : null}
          {diff && comparison ? (
            <div>
              <div className="mb-1 text-xs opacity-70">
                Diff: attempt #{comparison.previous.attemptNumber} → #
                {comparison.latest.attemptNumber}
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
          ) : loaded && attempts.length >= 1 && !comparison ? (
            <p className="text-xs opacity-60">단일 attempt — 비교할 이전 결과 없음.</p>
          ) : null}
        </div>
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
