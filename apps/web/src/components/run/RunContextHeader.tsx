'use client';

import { useState } from 'react';

interface Props {
  title: string;
  prompt: string;
  status?: string | null;
  teamName?: string | null;
}

export function RunContextHeader({ title, prompt, status, teamName }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const displayPrompt = prompt.replace(/^prompt:\s*/i, '');

  return (
    <div className="sticky top-0 z-10 -mx-6 border-b border-current/10 bg-white/95 px-6 py-3 backdrop-blur">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-base font-semibold">{title}</h1>
              {status ? (
                <span className="rounded-full border border-current/15 px-2 py-0.5 text-xs opacity-70">
                  {status}
                </span>
              ) : null}
              {teamName ? (
                <span className="truncate text-xs opacity-60">Team: {teamName}</span>
              ) : null}
            </div>
            {!collapsed ? (
              <p className="line-clamp-3 text-sm opacity-75">
                <span className="font-medium opacity-80">Prompt:</span> {displayPrompt}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="shrink-0 rounded-md border border-current/20 px-2 py-1 text-xs hover:bg-current/5"
          >
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </div>
    </div>
  );
}
