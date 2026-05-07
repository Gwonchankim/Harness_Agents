'use client';

import { useEffect, useReducer, useState } from 'react';

import { AgentReportPane } from './AgentReportPane';
import { DagGraph } from './DagGraph';

interface InitialAgent {
  id: string;
  name: string;
  role: string;
  isLead: boolean;
  provider: string;
  modelId: string;
}

interface InitialTask {
  id: string;
  taskKey: string;
  name: string;
  description: string;
  status: string;
  agentId: string | null;
  dependencies: string[];
  startedAt: string | null;
  completedAt: string | null;
  result: string | null;
  error: string | null;
}

interface InitialEvent {
  id: string;
  type: string;
  taskId: string | null;
  agentId: string | null;
  payload: unknown;
  createdAt: string;
}

interface InitialState {
  status: string;
  failedReason: string | null;
  team: { id: string; name: string; agents: InitialAgent[] };
  tasks: InitialTask[];
  events: InitialEvent[];
}

interface Props {
  runId: string;
  initial: InitialState;
}

interface State {
  status: string;
  failedReason: string | null;
  team: InitialState['team'];
  tasks: InitialTask[];
  taskOutputs: Record<string, string>;
  events: InitialEvent[];
  lastEventId: string | null;
  transport: 'connecting' | 'sse' | 'polling' | 'closed';
}

type Action =
  | { type: 'append-events'; events: InitialEvent[] }
  | { type: 'set-transport'; transport: State['transport'] }
  | { type: 'set-tasks'; tasks: InitialTask[] }
  | { type: 'set-run-meta'; status: string; failedReason: string | null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'append-events': {
      let tasks = state.tasks;
      let taskOutputs = state.taskOutputs;
      let status = state.status;
      let failedReason = state.failedReason;
      for (const ev of action.events) {
        const next = applyEvent(tasks, taskOutputs, ev);
        tasks = next.tasks;
        taskOutputs = next.taskOutputs;
        if (ev.type === 'run.started' && status === 'ready') status = 'planning';
        if (ev.type === 'plan.created' && (status === 'ready' || status === 'planning')) {
          status = 'running';
        }
        if (ev.type === 'run.completed') {
          const p = ev.payload as { success?: boolean; failedReason?: string };
          status = p?.success ? 'succeeded' : 'failed';
          if (p?.failedReason) failedReason = p.failedReason;
        }
      }
      const lastEventId =
        action.events.length > 0
          ? action.events[action.events.length - 1]!.id
          : state.lastEventId;
      return {
        ...state,
        tasks,
        taskOutputs,
        events: [...state.events, ...action.events].slice(-2000),
        lastEventId,
        status,
        failedReason,
      };
    }
    case 'set-transport':
      return { ...state, transport: action.transport };
    case 'set-tasks':
      return { ...state, tasks: action.tasks };
    case 'set-run-meta':
      return { ...state, status: action.status, failedReason: action.failedReason };
    default:
      return state;
  }
}

function applyEvent(
  tasks: InitialTask[],
  outputs: Record<string, string>,
  ev: InitialEvent,
): { tasks: InitialTask[]; taskOutputs: Record<string, string> } {
  const updateTaskByKey = (taskKey: string, patch: Partial<InitialTask>): InitialTask[] =>
    tasks.map((t) => (t.taskKey === taskKey ? { ...t, ...patch } : t));

  switch (ev.type) {
    case 'task.started': {
      const p = ev.payload as { taskKey?: string };
      if (typeof p?.taskKey === 'string') {
        return {
          tasks: updateTaskByKey(p.taskKey, { status: 'running', startedAt: ev.createdAt }),
          taskOutputs: outputs,
        };
      }
      break;
    }
    case 'task.completed': {
      const p = ev.payload as { taskKey?: string };
      if (typeof p?.taskKey === 'string') {
        return {
          tasks: updateTaskByKey(p.taskKey, { status: 'done', completedAt: ev.createdAt }),
          taskOutputs: outputs,
        };
      }
      break;
    }
    case 'task.failed': {
      const p = ev.payload as { taskKey?: string; error?: string };
      if (typeof p?.taskKey === 'string') {
        return {
          tasks: updateTaskByKey(p.taskKey, {
            status: 'failed',
            completedAt: ev.createdAt,
            error: p.error ?? 'failed',
          }),
          taskOutputs: outputs,
        };
      }
      break;
    }
    case 'agent.output.delta': {
      const p = ev.payload as { taskKey?: string; text?: string };
      if (typeof p?.taskKey === 'string' && typeof p.text === 'string') {
        const prev = outputs[p.taskKey] ?? '';
        return {
          tasks,
          taskOutputs: { ...outputs, [p.taskKey]: prev + p.text },
        };
      }
      break;
    }
  }
  return { tasks, taskOutputs: outputs };
}

function initialReducerState(initial: InitialState): State {
  const outputs: Record<string, string> = {};
  for (const t of initial.tasks) {
    if (t.result) outputs[t.taskKey] = t.result;
  }
  for (const ev of initial.events) {
    if (ev.type === 'agent.output.delta') {
      const p = ev.payload as { taskKey?: string; text?: string };
      if (typeof p?.taskKey === 'string' && typeof p.text === 'string') {
        outputs[p.taskKey] = (outputs[p.taskKey] ?? '') + p.text;
      }
    }
  }
  return {
    status: initial.status,
    failedReason: initial.failedReason,
    team: initial.team,
    tasks: initial.tasks,
    taskOutputs: outputs,
    events: initial.events,
    lastEventId:
      initial.events.length > 0 ? initial.events[initial.events.length - 1]!.id : null,
    transport: 'connecting',
  };
}

export function RunStream({ runId, initial }: Props) {
  const [state, dispatch] = useReducer(reducer, initial, initialReducerState);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const isTerminal = state.status === 'succeeded' || state.status === 'failed';

  useEffect(() => {
    if (isTerminal) {
      dispatch({ type: 'set-transport', transport: 'closed' });
      return;
    }
    let cancelled = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSeen: string | null = state.lastEventId;

    const startPolling = () => {
      dispatch({ type: 'set-transport', transport: 'polling' });
      const tick = async () => {
        if (cancelled) return;
        try {
          const url = `/api/runs/${runId}/state${
            lastSeen ? `?since=${encodeURIComponent(lastSeen)}` : ''
          }`;
          const res = await fetch(url, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as {
            run?: { status?: string; failedReason?: string | null };
            tasks?: InitialTask[];
            events?: InitialEvent[];
            nextSince?: string | null;
          };
          if (cancelled) return;
          if (Array.isArray(data.events) && data.events.length > 0) {
            dispatch({ type: 'append-events', events: data.events });
            if (data.nextSince) lastSeen = data.nextSince;
          }
          if (data.tasks) {
            dispatch({ type: 'set-tasks', tasks: data.tasks });
          }
          if (data.run?.status) {
            dispatch({
              type: 'set-run-meta',
              status: data.run.status,
              failedReason: data.run.failedReason ?? null,
            });
            if (data.run.status === 'succeeded' || data.run.status === 'failed') {
              cancelled = true;
              return;
            }
          }
        } catch {
          /* swallow; will retry */
        }
        pollTimer = setTimeout(tick, 1500);
      };
      void tick();
    };

    if (typeof EventSource === 'undefined') {
      startPolling();
    } else {
      try {
        const url = `/api/runs/${runId}/events${
          lastSeen ? `?since=${encodeURIComponent(lastSeen)}` : ''
        }`;
        es = new EventSource(url);
        es.onopen = () => {
          if (!cancelled) dispatch({ type: 'set-transport', transport: 'sse' });
        };
        es.onmessage = (ev) => {
          try {
            const parsed = JSON.parse(ev.data) as InitialEvent;
            const id = ev.lastEventId || parsed.id;
            dispatch({
              type: 'append-events',
              events: [{ ...parsed, id }],
            });
            if (id) lastSeen = id;
          } catch {
            /* ignore malformed */
          }
        };
        es.onerror = () => {
          es?.close();
          es = null;
          if (!cancelled) startPolling();
        };
      } catch {
        startPolling();
      }
    }

    return () => {
      cancelled = true;
      es?.close();
      if (pollTimer) clearTimeout(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, isTerminal]);

  async function startRun() {
    setStarting(true);
    setStartError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/start`, { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStartError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      dispatch({ type: 'set-run-meta', status: 'planning', failedReason: null });
    } finally {
      setStarting(false);
    }
  }

  const canStart = state.status === 'ready';
  const transportLabel: Record<State['transport'], string> = {
    connecting: 'connecting…',
    sse: 'SSE',
    polling: 'polling',
    closed: 'closed',
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={startRun}
          disabled={!canStart || starting}
          className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium hover:bg-current/5 disabled:opacity-40"
        >
          {starting
            ? 'Starting…'
            : canStart
              ? 'Start run'
              : `Status: ${state.status}`}
        </button>
        <span className="text-xs opacity-60">
          transport: {transportLabel[state.transport]}
          {state.lastEventId
            ? ` · last event ${state.lastEventId.slice(0, 8)}`
            : ''}
        </span>
        {state.failedReason ? (
          <span className="text-xs text-rose-500">
            failed: {state.failedReason}
          </span>
        ) : null}
        {startError ? (
          <span className="text-xs text-rose-500">{startError}</span>
        ) : null}
      </section>

      <DagGraph tasks={state.tasks} agents={state.team.agents} />

      <AgentReportPane
        tasks={state.tasks}
        agents={state.team.agents}
        outputs={state.taskOutputs}
      />
    </div>
  );
}
