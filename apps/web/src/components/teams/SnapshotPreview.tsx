'use client';

import { useState, type ReactNode } from 'react';

interface Props {
  agentsMd: string | null;
  teamJson: string | null;
}

// In-app preview of the active team snapshot. Source of truth is the DB
// (TeamRevision.agentsMd / teamJson), not the exported files on disk.
export function SnapshotPreview({ agentsMd, teamJson }: Props) {
  const [tab, setTab] = useState<'md' | 'json'>('md');
  const content = tab === 'md' ? agentsMd : teamJson;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <TabButton active={tab === 'md'} onClick={() => setTab('md')}>
          AGENTS.md
        </TabButton>
        <TabButton active={tab === 'json'} onClick={() => setTab('json')}>
          team.json
        </TabButton>
        <span className="ml-auto text-xs opacity-55">DB snapshot · current revision</span>
      </div>
      {content ? (
        <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap rounded-md border border-current/15 bg-current/5 p-4 text-xs leading-6">
          {content}
        </pre>
      ) : (
        <p className="rounded-md border border-current/15 p-3 text-sm opacity-65">
          No active revision snapshot is available for this team.
        </p>
      )}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-3 py-1 text-xs font-medium ${
        active ? 'border-current/40 bg-current/10' : 'border-current/15 opacity-70 hover:opacity-100'
      }`}
    >
      {children}
    </button>
  );
}
