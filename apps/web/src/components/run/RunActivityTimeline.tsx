'use client';

// Phase 13: chronological run activity timeline, built purely from the events the
// client already holds (state.events) via buildActivityTimeline — no new API.
// Default collapsed; auto-expanded for terminal-failure runs (failed/cancelled).
// agent.output.delta and other stream/team events are excluded by the transform.

import { useState } from 'react';

import { buildActivityTimeline, type ActivityEvent, type TimelineLevel } from '@lib/runs/activityTimeline';

interface Props {
  events: ActivityEvent[];
  tasks: { taskKey: string; name: string; agentId: string | null }[];
  agents: { id: string; name: string }[];
  runStatus: string;
}

const DOT: Record<TimelineLevel, string> = {
  info: 'bg-sky-500',
  success: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-rose-500',
  neutral: 'bg-current/30',
};

const TEXT: Record<TimelineLevel, string> = {
  info: '',
  success: 'text-emerald-700 dark:text-emerald-300',
  warn: 'text-amber-700 dark:text-amber-300',
  error: 'text-rose-700 dark:text-rose-300',
  neutral: 'opacity-60',
};

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

export function RunActivityTimeline({ events, tasks, agents, runStatus }: Props) {
  const items = buildActivityTimeline(events, { tasks, agents });
  // failed/cancelled runs start expanded (cancel is represented as status 'failed');
  // succeeded/other runs start collapsed.
  const [open, setOpen] = useState(() => runStatus === 'failed' || runStatus === 'cancelled');

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium uppercase tracking-wide opacity-60 hover:opacity-100"
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        <span>Run activity ({items.length})</span>
      </button>
      {open ? (
        items.length === 0 ? (
          <p className="mt-2 rounded-md border border-current/15 p-3 text-sm opacity-70">활동 기록 없음</p>
        ) : (
          <ol className="mt-2 max-h-[28rem] space-y-1 overflow-auto rounded-md border border-current/15 p-2 text-xs">
            {items.map((it) => (
              <li key={it.id} className="flex items-baseline gap-2">
                <span className={`relative top-[3px] h-1.5 w-1.5 shrink-0 rounded-full ${DOT[it.level]}`} aria-hidden />
                <span className="shrink-0 font-mono opacity-50">{fmtTime(it.at)}</span>
                <span className={TEXT[it.level]}>
                  {it.label}
                  {it.detail ? <span className="opacity-70"> · {it.detail}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </section>
  );
}
