'use client';

import { useState } from 'react';

import { parseJson } from '@lib/db/json';
import {
  countDiff,
  diffLines,
  summarizeTeamChanges,
  type DiffTeamSpec,
} from '@lib/feedback/diff';

import { RevisionDiff } from '@/components/feedback/RevisionDiff';

export interface RevisionHistoryItem {
  id: string;
  version: number;
  proposedBy: string;
  approvedBy: string | null;
  reason: string | null;
  sourceRunId: string | null;
  createdAt: string;
  approvedAt: string | null;
  agentsMd: string;
  teamJson: string;
}

// `revisions` is ordered version-descending; the previous version for diffing is
// the next item in the list.
export function RevisionHistory({ revisions }: { revisions: RevisionHistoryItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (revisions.length === 0) {
    return <p className="text-sm opacity-65">No revisions yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {revisions.map((rev, i) => {
        const prev = revisions[i + 1];
        const open = openId === rev.id;
        return (
          <li key={rev.id} className="rounded-md border border-current/15">
            <button
              type="button"
              onClick={() => setOpenId(open ? null : rev.id)}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-current/5"
            >
              <span className="font-medium">
                v{rev.version}
                {i === 0 ? ' · current' : ''}
              </span>
              <span className="text-xs opacity-65">
                {rev.proposedBy} → {rev.approvedBy ?? 'pending'}
              </span>
              {rev.reason ? (
                <span className="min-w-0 flex-1 truncate text-xs opacity-60">{rev.reason}</span>
              ) : null}
              <span className="ml-auto text-xs opacity-50">
                {new Date(rev.createdAt).toLocaleString()}
              </span>
              <span className="text-xs opacity-50">{open ? '▲' : '▼'}</span>
            </button>
            {open ? <RevisionDetail rev={rev} prev={prev} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

function RevisionDetail({
  rev,
  prev,
}: {
  rev: RevisionHistoryItem;
  prev: RevisionHistoryItem | undefined;
}) {
  if (!prev) {
    return (
      <div className="space-y-2 border-t border-current/10 p-3">
        <p className="text-xs opacity-70">Initial revision — full snapshot below.</p>
        <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md border border-current/15 bg-current/5 p-3 text-xs leading-6">
          {rev.agentsMd}
        </pre>
      </div>
    );
  }

  const diff = diffLines(prev.agentsMd, rev.agentsMd);
  const counts = countDiff(diff);
  const summary = summarizeTeamChanges(toSpec(prev.teamJson), toSpec(rev.teamJson));

  return (
    <div className="border-t border-current/10 p-3">
      <RevisionDiff
        rationale={rev.reason ?? `Changes from v${prev.version} to v${rev.version}`}
        diff={diff}
        summary={summary}
        counts={counts}
      />
    </div>
  );
}

interface TeamJsonAgent {
  name?: string;
  role?: string;
  isLead?: boolean;
  systemPrompt?: string;
  toolsAllowed?: string[];
  tags?: string[];
}

function toSpec(teamJson: string): DiffTeamSpec {
  const parsed = parseJson<{
    team?: { name?: string; description?: string | null };
    agents?: TeamJsonAgent[];
  }>(teamJson, {});
  return {
    name: parsed.team?.name ?? '',
    description: parsed.team?.description ?? null,
    agents: (parsed.agents ?? []).map((a) => ({
      agentId: null,
      name: a.name ?? '',
      isLead: Boolean(a.isLead),
      role: a.role ?? '',
      systemPrompt: a.systemPrompt ?? '',
      toolsAllowed: Array.isArray(a.toolsAllowed) ? a.toolsAllowed : [],
      tags: Array.isArray(a.tags) ? a.tags : [],
    })),
  };
}
