'use client';

import { useEffect, useRef, useState } from 'react';

import { CancelRunButton } from './CancelRunButton';

export type RunProgressStage = 'starting' | 'planning' | 'running';

interface OverlayTask {
  status: string;
  name: string;
  agentId: string | null;
}

interface OverlayAgent {
  id: string;
  name: string;
}

interface Props {
  runId: string;
  stage: RunProgressStage;
  transport: string;
  tasks: OverlayTask[];
  agents: OverlayAgent[];
  /** ISO timestamp the run started (planning), or null before that. */
  startedAt: string | null;
  /** ISO timestamp of the most recent run event, or null. */
  lastEventAt: string | null;
  /** True when any agent uses a local (Ollama) model, to set expectations. */
  hasLocalModel: boolean;
  /** Called after a successful cancel so the parent can move to the terminal UI. */
  onCancelled: () => void;
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatAge(ms: number): string {
  const total = Math.floor(ms / 1000);
  if (total < 60) return `${total}s ago`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}m ${s}s ago`;
}

export function RunProgressOverlay({
  runId,
  stage,
  transport,
  tasks,
  agents,
  startedAt,
  lastEventAt,
  hasLocalModel,
  onCancelled,
}: Props) {
  const mountedAt = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const isPlanning = stage === 'planning';
  const isRunning = stage === 'running';
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((task) => task.status === 'done').length;
  const activeTask =
    tasks.find((task) => task.status === 'running') ??
    tasks.find((task) => task.status === 'pending') ??
    null;
  const activeAgent = activeTask?.agentId
    ? agents.find((agent) => agent.id === activeTask.agentId)
    : null;

  const startMs = startedAt ? new Date(startedAt).getTime() : mountedAt.current;
  const elapsedMs = Math.max(0, now - startMs);
  const lastEventAgeMs = lastEventAt ? Math.max(0, now - new Date(lastEventAt).getTime()) : null;

  const steps = [
    { label: 'Start run', status: stage === 'starting' ? 'active' : 'done' },
    {
      label: 'Lead plans DAG',
      status: isPlanning ? 'active' : isRunning ? 'done' : 'pending',
    },
    { label: 'Agents execute tasks', status: isRunning ? 'active' : 'pending' },
    { label: 'Complete run', status: 'pending' },
  ] as const;

  const title = isRunning
    ? 'Agents are working'
    : isPlanning
      ? 'Lead is building the DAG'
      : 'Starting the run';
  const detail = isRunning
    ? activeTask
      ? `${activeAgent?.name ?? 'An agent'} is working on ${activeTask.name}.`
      : 'The team is executing the planned tasks and streaming progress.'
    : isPlanning
      ? 'The Lead agent is reading the prompt, Q&A history, and team roles, then creating task nodes and dependencies.'
      : 'The app is switching this run into planning mode and preparing the execution worker.';

  return (
    <div className="absolute inset-0 z-20 flex min-h-[360px] items-start justify-center bg-white/55 px-4 pt-10 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-current/15 bg-white p-5 shadow-lg">
        <div className="flex items-start gap-3">
          <div
            aria-hidden="true"
            className="mt-1 h-7 w-7 shrink-0 animate-spin rounded-full border-2 border-current/20 border-t-current"
          />
          <div className="space-y-2">
            <h2 className="text-base font-medium">{title}</h2>
            <p className="text-sm opacity-70">{detail}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-60">
              <span>Elapsed: {formatDuration(elapsedMs)}</span>
              <span>Transport: {transport}</span>
              {isRunning && totalTasks > 0 ? (
                <span>
                  Tasks: {doneTasks} / {totalTasks} complete
                </span>
              ) : null}
              {lastEventAgeMs != null ? (
                <span>Last update: {formatAge(lastEventAgeMs)}</span>
              ) : null}
            </div>
          </div>
        </div>

        <ol className="mt-5 space-y-2 text-sm">
          {steps.map((step, idx) => (
            <li key={step.label} className="flex items-center gap-3">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs ${
                  step.status === 'done'
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : step.status === 'active'
                      ? 'border-current bg-current text-white'
                      : 'border-current/20 opacity-60'
                }`}
              >
                {idx + 1}
              </span>
              <span
                className={
                  step.status === 'active'
                    ? 'font-medium'
                    : step.status === 'done'
                      ? 'opacity-80'
                      : 'opacity-50'
                }
              >
                {step.label}
              </span>
            </li>
          ))}
        </ol>

        <p className="mt-5 text-xs opacity-60">
          {hasLocalModel
            ? 'Local models (Ollama) can take a while to respond. The page updates automatically as progress streams in.'
            : 'This can take a little while. The page updates automatically as progress streams in.'}
        </p>

        <div className="mt-4 border-t border-current/10 pt-4">
          <CancelRunButton runId={runId} onCancelled={onCancelled} />
        </div>
      </div>
    </div>
  );
}
