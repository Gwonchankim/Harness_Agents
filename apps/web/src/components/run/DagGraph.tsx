'use client';

import { transitiveDownstream } from '@lib/dag/downstream';

import { RerunTaskButton } from './RerunTaskButton';

interface Agent {
  id: string;
  name: string;
  role: string;
  isLead: boolean;
  provider: string;
  modelId: string;
}

interface Task {
  id: string;
  taskKey: string;
  name: string;
  status: string;
  agentId: string | null;
  dependencies: string[];
}

const STATUS_STYLE: Record<string, string> = {
  pending: 'border-current/20 bg-transparent opacity-70',
  running: 'border-sky-500/40 bg-sky-500/10',
  done: 'border-emerald-500/40 bg-emerald-500/10',
  failed: 'border-rose-500/40 bg-rose-500/10',
  blocked: 'border-amber-500/40 bg-amber-500/10',
  cancelled: 'border-current/25 bg-current/5 opacity-60',
};

export function DagGraph({
  tasks,
  agents,
  runId,
  runStatus,
  onRerun,
}: {
  tasks: Task[];
  agents: Agent[];
  runId?: string;
  runStatus?: string;
  onRerun?: () => void;
}) {
  const agentById = new Map(agents.map((a) => [a.id, a] as const));
  // Phase 9: re-run a task from a terminal run (failed | succeeded). Only terminal
  // tasks (done/failed/cancelled) can be re-run.
  const terminalRun = runStatus === 'failed' || runStatus === 'succeeded';
  const canRerun = (status: string) =>
    status === 'done' || status === 'failed' || status === 'cancelled';
  const showRerun = Boolean(runId && onRerun && terminalRun);
  if (tasks.length === 0) {
    return (
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide opacity-60">DAG</h2>
        <p className="rounded-md border border-current/15 p-3 text-sm opacity-70">
          No execution plan yet. The Lead will produce one after Start.
        </p>
      </section>
    );
  }
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide opacity-60">
        DAG ({tasks.length} tasks)
      </h2>
      <ol className="space-y-2">
        {tasks.map((t, i) => {
          const agent = t.agentId ? agentById.get(t.agentId) : null;
          const cls = STATUS_STYLE[t.status] ?? STATUS_STYLE.pending!;
          return (
            <li
              key={t.id}
              className={`rounded-md border p-3 text-sm transition-colors ${cls}`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-xs opacity-70">
                  #{i + 1} · {t.taskKey}
                </span>
                <span className="text-xs uppercase tracking-wide opacity-70">
                  {t.status}
                </span>
              </div>
              <div className="mt-1 font-medium">{t.name}</div>
              <div className="mt-1 text-xs opacity-70">
                Agent: {agent?.name ?? '—'}
                {t.dependencies.length > 0 ? (
                  <>
                    {' · depends on '}
                    {t.dependencies.map((d, di) => (
                      <span key={d}>
                        <code className="rounded bg-current/10 px-1">{d}</code>
                        {di < t.dependencies.length - 1 ? ', ' : ''}
                      </span>
                    ))}
                  </>
                ) : null}
              </div>
              {showRerun && canRerun(t.status) ? (
                <div className="mt-2">
                  <RerunTaskButton
                    runId={runId!}
                    taskId={t.id}
                    downstreamCount={transitiveDownstream(tasks, t.taskKey).size}
                    onRerun={onRerun}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
