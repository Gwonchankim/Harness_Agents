'use client';

import { useEffect, useReducer, useState } from 'react';

import { classifyFailure } from '@lib/runs/failureClass';

import { RetryRunButton } from '@/components/runs/RetryRunButton';

import { AgentReportPane } from './AgentReportPane';
import { ResumeRunButton } from './ResumeRunButton';
import { DagGraph } from './DagGraph';
import { RunActivityTimeline } from './RunActivityTimeline';
import { RunProgressOverlay, type RunProgressStage } from './RunProgressOverlay';

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
  startedAt: string | null;
  team: { id: string; name: string; agents: InitialAgent[] };
  tasks: InitialTask[];
  events: InitialEvent[];
  modelCatalog: ModelCatalogClient[];
  finalResult: string | null;
}

interface Props {
  runId: string;
  initial: InitialState;
}

interface ModelCatalogClient {
  modelId: string;
  displayName: string;
  provider: string;
  isDefault: boolean;
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
  finalResult: string | null;
}

type ProviderKey = 'openai' | 'anthropic' | 'google' | 'ollama';

const RUN_EVENT_TYPES = [
  'run.started',
  'plan.created',
  'task.started',
  'agent.output.delta',
  'agent.output.completed',
  'task.completed',
  'task.failed',
  'task.retry.attempt',
  'task.reset',
  'result.created',
  'run.completed',
  'run.cancelled',
  'run.resumed',
] as const;

type Action =
  | { type: 'append-events'; events: InitialEvent[] }
  | { type: 'set-transport'; transport: State['transport'] }
  | { type: 'set-tasks'; tasks: InitialTask[] }
  | { type: 'set-team-agents'; agents: InitialAgent[] }
  | { type: 'set-run-meta'; status: string; failedReason: string | null }
  | { type: 'set-final-result'; finalResult: string | null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'append-events': {
      let tasks = state.tasks;
      let taskOutputs = state.taskOutputs;
      let status = state.status;
      let failedReason = state.failedReason;
      let finalResult = state.finalResult;
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
        if (ev.type === 'run.cancelled') {
          status = 'failed';
          const p = ev.payload as { failedReason?: string };
          failedReason = p?.failedReason ?? 'user_cancelled';
        }
        if (ev.type === 'run.resumed') {
          status = 'running';
          failedReason = null;
          finalResult = null;
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
        finalResult,
      };
    }
    case 'set-transport':
      return { ...state, transport: action.transport };
    case 'set-tasks':
      return { ...state, tasks: action.tasks };
    case 'set-team-agents':
      return { ...state, team: { ...state.team, agents: action.agents } };
    case 'set-run-meta':
      return { ...state, status: action.status, failedReason: action.failedReason };
    case 'set-final-result':
      return { ...state, finalResult: action.finalResult };
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
        // Reset this task's output buffer on (re)start so a resumed/retried
        // attempt's stream does not concatenate onto the previous attempt.
        return {
          tasks: updateTaskByKey(p.taskKey, { status: 'running', startedAt: ev.createdAt }),
          taskOutputs: { ...outputs, [p.taskKey]: '' },
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
    case 'task.reset': {
      // Phase 9: a re-run reset this task to pending. Clear its output buffer so
      // the new attempt's stream does not concatenate onto the previous result.
      const p = ev.payload as { taskKey?: string };
      if (typeof p?.taskKey === 'string') {
        return {
          tasks: updateTaskByKey(p.taskKey, {
            status: 'pending',
            error: null,
            completedAt: null,
            result: null,
          }),
          taskOutputs: { ...outputs, [p.taskKey]: '' },
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
  // Rebuild outputs by replaying the streamed deltas with the same reset semantics
  // as the live reducer: each `task.reset`/`task.started` clears the buffer so only
  // the latest attempt's stream survives (matters after resume/retry). Then fall
  // back to the persisted `Task.result` for done tasks whose deltas are not in the
  // event window (so their output is never blank, and never doubled).
  const outputs: Record<string, string> = {};
  for (const ev of initial.events) {
    if (ev.type === 'task.started' || ev.type === 'task.reset') {
      const p = ev.payload as { taskKey?: string };
      if (typeof p?.taskKey === 'string') outputs[p.taskKey] = '';
    } else if (ev.type === 'agent.output.delta') {
      const p = ev.payload as { taskKey?: string; text?: string };
      if (typeof p?.taskKey === 'string' && typeof p.text === 'string') {
        outputs[p.taskKey] = (outputs[p.taskKey] ?? '') + p.text;
      }
    }
  }
  for (const t of initial.tasks) {
    if (t.result && !outputs[t.taskKey]) outputs[t.taskKey] = t.result;
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
    finalResult: initial.finalResult,
  };
}

export function RunStream({ runId, initial }: Props) {
  const [state, dispatch] = useReducer(reducer, initial, initialReducerState);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [modelEdits, setModelEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(initial.team.agents.map((a) => [a.id, a.modelId])),
  );
  const [savingModels, setSavingModels] = useState(false);
  const [modelSaveMessage, setModelSaveMessage] = useState<string | null>(null);
  const [modelSaveError, setModelSaveError] = useState<string | null>(null);
  const [streamRunNonce, setStreamRunNonce] = useState(0);

  const isTerminal = state.status === 'succeeded' || state.status === 'failed';
  const recoverableModelFailure = isRecoverableModelFailure(state.failedReason);
  const showRetryPanel =
    state.status === 'failed' &&
    classifyFailure(state.failedReason).recoveryAction === 'retry';
  // Resumable = failed run that has a plan (tasks exist) with at least one
  // failed/cancelled task. Done tasks are reused; only the rest re-run.
  const resumableDoneCount = state.tasks.filter((t) => t.status === 'done').length;
  const resumable =
    state.status === 'failed' &&
    state.tasks.length > 0 &&
    resumableDoneCount > 0 &&
    state.tasks.some((t) => t.status === 'failed' || t.status === 'cancelled');

  useEffect(() => {
    if (isTerminal) {
      dispatch({ type: 'set-transport', transport: 'closed' });
      return;
    }
    let cancelled = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let connectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconcileTimer: ReturnType<typeof setInterval> | null = null;
    let lastSeen: string | null = state.lastEventId;
    let pollingStarted = false;

    const fetchStateSnapshot = async (): Promise<boolean> => {
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
        finalResult?: string | null;
      };
      if (cancelled) return true;
      if (Array.isArray(data.events) && data.events.length > 0) {
        dispatch({ type: 'append-events', events: data.events });
        if (data.nextSince) lastSeen = data.nextSince;
      }
      if (data.tasks) {
        dispatch({ type: 'set-tasks', tasks: data.tasks });
      }
      if ('finalResult' in data) {
        dispatch({ type: 'set-final-result', finalResult: data.finalResult ?? null });
      }
      if (data.run?.status) {
        dispatch({
          type: 'set-run-meta',
          status: data.run.status,
          failedReason: data.run.failedReason ?? null,
        });
        if (data.run.status === 'succeeded' || data.run.status === 'failed') {
          return true;
        }
      }
      return false;
    };

    const startPolling = () => {
      if (cancelled || pollingStarted) return;
      pollingStarted = true;
      es?.close();
      es = null;
      if (connectTimer) clearTimeout(connectTimer);
      if (reconcileTimer) clearInterval(reconcileTimer);
      dispatch({ type: 'set-transport', transport: 'polling' });
      const tick = async () => {
        if (cancelled) return;
        try {
          if (await fetchStateSnapshot()) {
            cancelled = true;
            return;
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
        connectTimer = setTimeout(() => {
          if (!cancelled && es) startPolling();
        }, 4000);
        es.onopen = () => {
          if (connectTimer) clearTimeout(connectTimer);
          if (!cancelled) {
            dispatch({ type: 'set-transport', transport: 'sse' });
            reconcileTimer = setInterval(() => {
              void fetchStateSnapshot()
                .then((terminal) => {
                  if (terminal) {
                    cancelled = true;
                    es?.close();
                    if (reconcileTimer) clearInterval(reconcileTimer);
                  }
                })
                .catch(() => {
                  /* SSE is still primary; polling fallback handles hard errors */
                });
            }, 5000);
          }
        };
        const closeLiveStream = () => {
          cancelled = true;
          es?.close();
          es = null;
          if (connectTimer) clearTimeout(connectTimer);
          if (reconcileTimer) clearInterval(reconcileTimer);
          dispatch({ type: 'set-transport', transport: 'closed' });
        };
        const handleEvent = (ev: MessageEvent<string>) => {
          try {
            const parsed = JSON.parse(ev.data) as InitialEvent;
            const id = ev.lastEventId || parsed.id;
            dispatch({
              type: 'append-events',
              events: [{ ...parsed, id }],
            });
            if (id) lastSeen = id;
            const terminalEvent =
              parsed.type === 'run.completed' || parsed.type === 'run.cancelled';
            if (parsed.type === 'result.created' || terminalEvent) {
              void fetchStateSnapshot()
                .catch(() => {
                  /* polling fallback will recover non-terminal hard errors */
                })
                .finally(() => {
                  if (terminalEvent) closeLiveStream();
                });
            }
          } catch {
            /* ignore malformed */
          }
        };
        es.onmessage = handleEvent;
        for (const type of RUN_EVENT_TYPES) {
          es.addEventListener(type, handleEvent);
        }
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
      if (connectTimer) clearTimeout(connectTimer);
      if (reconcileTimer) clearInterval(reconcileTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, streamRunNonce]);

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
      window.location.reload();
    } finally {
      setStarting(false);
    }
  }

  async function saveTeamModels() {
    setSavingModels(true);
    setModelSaveMessage(null);
    setModelSaveError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/team-models`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agents: state.team.agents.map((agent) => ({
            agentId: agent.id,
            modelId: modelEdits[agent.id] ?? agent.modelId,
          })),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        agents?: InitialAgent[];
        status?: string;
        failedReason?: string | null;
        resetToReady?: boolean;
      };
      if (!res.ok || !Array.isArray(body.agents) || typeof body.status !== 'string') {
        setModelSaveError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      dispatch({ type: 'set-team-agents', agents: body.agents });
      dispatch({
        type: 'set-run-meta',
        status: body.status,
        failedReason: body.failedReason ?? null,
      });
      setModelEdits(Object.fromEntries(body.agents.map((a) => [a.id, a.modelId])));
      setStartError(null);
      setModelSaveMessage(
        body.resetToReady
          ? 'Models saved. This run is ready to start again.'
          : 'Models saved.',
      );
      if (body.resetToReady) {
        window.location.assign(`/runs/${runId}`);
      }
    } finally {
      setSavingModels(false);
    }
  }

  const canStart = state.status === 'ready';
  const transportLabel: Record<State['transport'], string> = {
    connecting: 'connecting...',
    sse: 'SSE',
    polling: 'polling',
    closed: 'closed',
  };
  const progressStage: RunProgressStage | null = starting
    ? 'starting'
    : state.status === 'planning'
      ? 'planning'
      : state.status === 'running'
        ? 'running'
      : null;

  return (
    <div className="relative">
      <div
        className={`space-y-6 transition duration-200 ${
          progressStage
            ? 'pointer-events-none select-none opacity-45 blur-[2px]'
            : ''
        }`}
      >
        <section className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={startRun}
            disabled={!canStart || starting}
            className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium hover:bg-current/5 disabled:opacity-40"
          >
            {starting
              ? 'Starting...'
              : canStart
                ? 'Start run'
                : `Status: ${state.status}`}
          </button>
          <span className="text-xs opacity-60">
            transport: {transportLabel[state.transport]}
            {state.lastEventId
              ? ` - last event ${state.lastEventId.slice(0, 8)}`
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

        {recoverableModelFailure ? (
          <TeamModelRecoveryPanel
            failedReason={state.failedReason}
            agents={state.team.agents}
            modelCatalog={initial.modelCatalog}
            modelEdits={modelEdits}
            onChange={(agentId, modelId) =>
              setModelEdits((prev) => ({ ...prev, [agentId]: modelId }))
            }
            onSave={saveTeamModels}
            saving={savingModels}
            message={modelSaveMessage}
            error={modelSaveError}
          />
        ) : null}

        {resumable ? (
          <ResumeRunButton
            runId={runId}
            doneCount={resumableDoneCount}
            onResumed={() => {
              dispatch({ type: 'set-run-meta', status: 'running', failedReason: null });
              setStreamRunNonce((value) => value + 1);
            }}
          />
        ) : null}

        {showRetryPanel ? (
          <RetryRunButton
            runId={runId}
            failedReason={state.failedReason}
            actionLabel={resumable ? 'Retry from scratch' : undefined}
            onReset={() =>
              dispatch({ type: 'set-run-meta', status: 'ready', failedReason: null })
            }
          />
        ) : null}

        <DagGraph
          tasks={state.tasks}
          agents={state.team.agents}
          runId={runId}
          runStatus={state.status}
          onRerun={() => {
            dispatch({ type: 'set-run-meta', status: 'running', failedReason: null });
            setStreamRunNonce((value) => value + 1);
          }}
        />

        <FinalResultPane finalResult={state.finalResult} status={state.status} runId={runId} />

        <RunActivityTimeline
          events={state.events}
          tasks={state.tasks}
          agents={state.team.agents}
          runStatus={state.status}
        />

        <AgentReportPane
          tasks={state.tasks}
          agents={state.team.agents}
          outputs={state.taskOutputs}
        />
      </div>

      {progressStage ? (
        <RunProgressOverlay
          runId={runId}
          stage={progressStage}
          transport={transportLabel[state.transport]}
          tasks={state.tasks}
          agents={state.team.agents}
          startedAt={initial.startedAt}
          lastEventAt={
            state.events.length > 0
              ? state.events[state.events.length - 1]!.createdAt
              : null
          }
          hasLocalModel={state.team.agents.some((a) => a.provider === 'ollama')}
          onCancelled={() =>
            dispatch({
              type: 'set-run-meta',
              status: 'failed',
              failedReason: 'user_cancelled',
            })
          }
        />
      ) : null}
    </div>
  );
}
const PROVIDER_LABELS: Record<ProviderKey, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  ollama: 'Local',
};

function isProviderKey(value: string): value is ProviderKey {
  return value === 'openai' || value === 'anthropic' || value === 'google' || value === 'ollama';
}

function isRecoverableModelFailure(reason: string | null): boolean {
  return Boolean(
    reason &&
      (reason.startsWith('lead_plan_provider_unavailable:') ||
        reason.startsWith('lead_plan_provider_auth:') ||
        reason.startsWith('lead_plan_unknown_provider:') ||
        reason === 'lead_plan_schema_error' ||
        reason.startsWith('lead_plan_model_not_found:') ||
        reason.startsWith('lead_plan_timeout:')),
  );
}

function recoveryCopy(failedReason: string | null): {
  title: string;
  reason: string;
  action: string;
} {
  if (failedReason === 'lead_plan_schema_error') {
    return {
      title: 'Lead planning model needs attention',
      reason:
        'The Lead agent started planning, but the model returned a malformed execution plan instead of the required DAG structure.',
      action:
        'Switch the Lead agent to a stronger structured-output model, then save. This will return the run to the ready state so you can start it again.',
    };
  }
  if (failedReason?.startsWith('lead_plan_timeout:')) {
    return {
      title: 'Lead planning took too long',
      reason:
        'The Lead agent started planning, but the selected model did not return an execution plan before the timeout.',
      action:
        'Switch the Lead agent to a faster or stronger model, then save. This will return the run to the ready state so you can start it again.',
    };
  }
  if (failedReason?.startsWith('lead_plan_model_not_found:')) {
    return {
      title: 'Model not found',
      reason:
        'The Lead planning model is not recognized by its provider — it may have been renamed or removed.',
      action:
        'Switch the Lead agent to a valid model, then save. This will return the run to the ready state so you can start it again.',
    };
  }
  return {
    title: 'Team model configuration needed',
    reason: 'The run stopped because one of the configured providers is unavailable.',
    action:
      'Change the affected agents to an available provider/model, then save. This will return the run to the ready state so you can start it again.',
  };
}

function TeamModelRecoveryPanel({
  failedReason,
  agents,
  modelCatalog,
  modelEdits,
  onChange,
  onSave,
  saving,
  message,
  error,
}: {
  failedReason: string | null;
  agents: InitialAgent[];
  modelCatalog: ModelCatalogClient[];
  modelEdits: Record<string, string>;
  onChange: (agentId: string, modelId: string) => void;
  onSave: () => void;
  saving: boolean;
  message: string | null;
  error: string | null;
}) {
  const modelsByProvider = modelCatalog.reduce<Record<ProviderKey, ModelCatalogClient[]>>(
    (acc, model) => {
      if (isProviderKey(model.provider)) acc[model.provider].push(model);
      return acc;
    },
    { openai: [], anthropic: [], google: [], ollama: [] },
  );

  function currentProvider(agent: InitialAgent): ProviderKey {
    const modelId = modelEdits[agent.id] ?? agent.modelId;
    const row = modelCatalog.find((model) => model.modelId === modelId);
    if (row && isProviderKey(row.provider)) return row.provider;
    return isProviderKey(agent.provider) ? agent.provider : 'ollama';
  }

  function pickModel(provider: ProviderKey): string {
    const models = modelsByProvider[provider];
    return models.find((model) => model.isDefault)?.modelId ?? models[0]?.modelId ?? '';
  }

  const canSave = agents.every((agent) => (modelEdits[agent.id] ?? agent.modelId).length > 0);
  const copy = recoveryCopy(failedReason);

  return (
    <section className="space-y-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
      <div className="space-y-1">
        <h2 className="text-base font-medium text-amber-800">
          {copy.title}
        </h2>
        <p className="opacity-75">
          {copy.reason}
          <code className="ml-1 rounded bg-current/10 px-1 py-0.5">
            {failedReason}
          </code>
        </p>
        <p className="opacity-75">
          {copy.action}
        </p>
      </div>

      <ul className="space-y-3">
        {agents.map((agent) => {
          const provider = currentProvider(agent);
          const providerModels = modelsByProvider[provider];
          const selectedModelId = modelEdits[agent.id] ?? agent.modelId;
          return (
            <li
              key={agent.id}
              className="grid grid-cols-1 gap-3 rounded-md border border-current/15 bg-white/70 p-3 sm:grid-cols-[1fr_160px_220px]"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">
                  {agent.name}
                  {agent.isLead ? ' (Lead)' : ''}
                </div>
                <div className="truncate text-xs opacity-65">{agent.role}</div>
              </div>
              <select
                value={provider}
                onChange={(event) => {
                  const next = event.target.value;
                  if (!isProviderKey(next)) return;
                  onChange(agent.id, pickModel(next));
                }}
                className="rounded-md border border-current/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-current/50"
              >
                {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={selectedModelId}
                onChange={(event) => onChange(agent.id, event.target.value)}
                disabled={providerModels.length === 0}
                className="rounded-md border border-current/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-current/50 disabled:opacity-50"
              >
                {providerModels.length > 0 ? (
                  providerModels.map((model) => (
                    <option key={model.modelId} value={model.modelId}>
                      {model.displayName}
                      {model.isDefault ? ' - default' : ''}
                    </option>
                  ))
                ) : (
                  <option value="">No enabled models</option>
                )}
              </select>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving || !canSave}
          onClick={onSave}
          className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium hover:bg-current/5 disabled:opacity-40"
        >
          {saving ? 'Saving models...' : 'Save models and retry'}
        </button>
        {message ? (
          <span className="text-xs text-emerald-700">{message}</span>
        ) : null}
        {error ? (
          <span className="text-xs text-rose-600">{error}</span>
        ) : null}
      </div>
    </section>
  );
}

function FinalResultPane({
  finalResult,
  status,
  runId,
}: {
  finalResult: string | null;
  status: string;
  runId: string;
}) {
  if (!finalResult && status !== 'succeeded') return null;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          Final result
        </h2>
        {status === 'succeeded' ? (
          <a
            href={`/runs/${runId}/feedback`}
            className="rounded-md border border-current/30 px-3 py-1 text-xs font-medium hover:bg-current/5"
          >
            Give feedback
          </a>
        ) : null}
      </div>
      {finalResult ? (
        <pre className="max-h-[42rem] overflow-auto whitespace-pre-wrap rounded-md border border-current/15 bg-current/5 p-4 text-sm leading-6">
          {finalResult}
        </pre>
      ) : (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700">
          This run completed before final result export was available. Agent outputs are still available below.
        </p>
      )}
    </section>
  );
}
