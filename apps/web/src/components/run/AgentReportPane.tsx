'use client';

import { useState } from 'react';

interface Agent {
  id: string;
  name: string;
  isLead: boolean;
}

interface Task {
  id: string;
  taskKey: string;
  name: string;
  status: string;
  agentId: string | null;
  error: string | null;
}

export function AgentReportPane({
  tasks,
  agents,
  outputs,
}: {
  tasks: Task[];
  agents: Agent[];
  outputs: Record<string, string>;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const agentById = new Map(agents.map((a) => [a.id, a] as const));
  if (tasks.length === 0) {
    return (
      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide opacity-60">
          Agent output
        </h2>
        <p className="rounded-md border border-current/15 p-3 text-sm opacity-70">
          Per-agent output will appear here once tasks start running.
        </p>
      </section>
    );
  }
  return (
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide opacity-60">
        Agent output
      </h2>
      <ul className="space-y-3">
        {tasks.map((t) => {
          const agent = t.agentId ? agentById.get(t.agentId) : null;
          const text = outputs[t.taskKey] ?? '';
          const defaultOpen = t.status === 'running' || t.status === 'failed';
          const isOpen = expanded[t.id] ?? defaultOpen;
          return (
            <li key={t.id} className="rounded-md border border-current/15 p-3 text-sm">
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [t.id]: !isOpen }))
                }
                className="flex w-full items-baseline justify-between gap-2 text-left"
              >
                <span className="font-medium">
                  {agent?.name ?? '—'} ·{' '}
                  <span className="font-mono text-xs opacity-70">{t.taskKey}</span>
                </span>
                <span className="text-xs opacity-70">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen ? (
                <div className="mt-2 space-y-2">
                  {t.error ? (
                    <p className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-700 dark:text-rose-300">
                      {t.error}
                    </p>
                  ) : null}
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-current/10 bg-current/5 p-2 text-xs">
                    {text ||
                      (t.status === 'pending'
                        ? '(waiting)'
                        : t.status === 'running'
                          ? '(streaming…)'
                          : '(no output)')}
                  </pre>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
