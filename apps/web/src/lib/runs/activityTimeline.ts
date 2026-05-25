// Phase 13: pure transform from RunEvents to a human-readable activity timeline.
// No I/O, no React — unit-testable. Consumed by RunActivityTimeline.tsx, fed from
// the client's existing `state.events` (no new API).
//
// Rules:
//   - Hard-exclude high-volume / out-of-scope events: agent.output.delta,
//     agent.output.completed, revision.*, feedback.*. (agent.output.delta must
//     NEVER appear on the timeline.)
//   - Known run/task lifecycle + control events get a labelled item with a level.
//   - Unknown / future / old event types are kept but rendered as `neutral` so a
//     historical run never breaks.
//   - `run.running` is recognized (future-proof) but is not currently emitted, so
//     it simply never appears in real data.
//   - Input order is preserved (callers pass events already ordered createdAt asc).

export type TimelineLevel = 'info' | 'success' | 'warn' | 'error' | 'neutral';

export interface TimelineItem {
  id: string;
  at: string; // createdAt ISO
  type: string;
  level: TimelineLevel;
  label: string;
  detail?: string;
}

export interface ActivityEvent {
  id: string;
  type: string;
  taskId?: string | null;
  agentId?: string | null;
  payload?: unknown;
  createdAt: string;
}

export interface ActivityCtx {
  tasks?: readonly { taskKey: string; name: string; agentId: string | null }[];
  agents?: readonly { id: string; name: string }[];
}

function isExcluded(type: string): boolean {
  return (
    type === 'agent.output.delta' ||
    type === 'agent.output.completed' ||
    type.startsWith('revision.') ||
    type.startsWith('feedback.')
  );
}

function rec(p: unknown): Record<string, unknown> {
  return p && typeof p === 'object' ? (p as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function fmtMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
function joinDetail(parts: (string | undefined)[]): string | undefined {
  const kept = parts.filter((x): x is string => !!x);
  return kept.length > 0 ? kept.join(' · ') : undefined;
}

export function buildActivityTimeline(
  events: readonly ActivityEvent[],
  ctx: ActivityCtx = {},
): TimelineItem[] {
  const taskName = new Map((ctx.tasks ?? []).map((t) => [t.taskKey, t.name] as const));
  const agentName = new Map((ctx.agents ?? []).map((a) => [a.id, a.name] as const));

  const items: TimelineItem[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (isExcluded(ev.type)) continue;
    // Dedupe by event id: the client's event list can briefly hold the same event
    // twice (SSE stream + state snapshot starting from the same cursor), and this
    // timeline is the first consumer to render one node per event id.
    if (seen.has(ev.id)) continue;
    seen.add(ev.id);
    const p = rec(ev.payload);
    const tk = str(p.taskKey);
    const tn = (tk ? (taskName.get(tk) ?? tk) : undefined) ?? 'task';
    const an = str(p.agentName) ?? (ev.agentId ? agentName.get(ev.agentId) : undefined);
    const m = describe(ev.type, p, tn, an);
    items.push({ id: ev.id, at: ev.createdAt, type: ev.type, level: m.level, label: m.label, detail: m.detail });
  }
  return items;
}

function describe(
  type: string,
  p: Record<string, unknown>,
  tn: string,
  an: string | undefined,
): { level: TimelineLevel; label: string; detail?: string } {
  switch (type) {
    case 'run.started':
      return { level: 'info', label: 'Run started' };
    case 'plan.created': {
      const n = num(p.taskCount);
      return { level: 'info', label: 'Execution plan created', detail: n != null ? `${n} tasks` : undefined };
    }
    case 'run.running': // future-proof: not currently emitted
      return { level: 'info', label: 'Run running' };
    case 'task.started':
      return { level: 'info', label: `Task ${tn} started`, detail: an ? `Agent ${an}` : undefined };
    case 'task.completed': {
      const d = num(p.durationMs);
      return { level: 'success', label: `Task ${tn} completed`, detail: d != null ? fmtMs(d) : undefined };
    }
    case 'task.failed': {
      const d = num(p.durationMs);
      return {
        level: 'error',
        label: `Task ${tn} failed`,
        detail: joinDetail([str(p.error), d != null ? fmtMs(d) : undefined]),
      };
    }
    case 'task.retry.attempt': {
      const a = num(p.attempt);
      const dl = num(p.delayMs);
      return {
        level: 'warn',
        label: `Task ${tn} retry${a != null ? ` #${a}` : ''}`,
        detail: joinDetail([str(p.kind), dl != null ? `${fmtMs(dl)} backoff` : undefined]),
      };
    }
    case 'task.reset': {
      const ps = str(p.previousStatus);
      return {
        level: 'warn',
        label: `Task ${tn} reset`,
        detail: joinDetail([ps ? `was ${ps}` : undefined, str(p.reason)]),
      };
    }
    case 'run.resumed': {
      const mode = str(p.mode);
      const trigger = str(p.trigger);
      const rt = num(p.resumedTasks);
      const dr = num(p.doneReused);
      const head = mode ? `Run resumed (${mode}${trigger ? `, ${trigger}` : ''})` : 'Run resumed';
      return {
        level: 'warn',
        label: head,
        detail: joinDetail([rt != null ? `${rt} re-run` : undefined, dr != null ? `${dr} reused` : undefined]),
      };
    }
    case 'run.autoresume.failed':
      return { level: 'error', label: 'Auto-resume failed', detail: str(p.reason) };
    case 'run.cancelled': {
      const c = num(p.cancelledTasks);
      return { level: 'error', label: 'Run cancelled', detail: c != null ? `${c} tasks cancelled` : undefined };
    }
    case 'run.completed': {
      if (p.success === true) return { level: 'success', label: 'Run completed' };
      return { level: 'error', label: 'Run failed', detail: str(p.failedReason) };
    }
    case 'result.created':
      return { level: 'info', label: 'Result exported' };
    default:
      // Unknown / old / future event type — keep but render neutral.
      return { level: 'neutral', label: type };
  }
}
