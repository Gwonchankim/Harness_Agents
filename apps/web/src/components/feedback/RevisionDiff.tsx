'use client';

// Presentational AGENTS.md diff renderer for the revision review. Consumes the
// pure diff output from lib/feedback/diff.ts (no diff logic here). Dedicated to
// before/after diffs — the Phase 3 RevisionDiffViewer preview is left untouched.

import type { DiffLine, DiffLineType, TeamChangeSummary } from '@lib/feedback/diff';

interface Props {
  rationale: string;
  diff: DiffLine[];
  summary: TeamChangeSummary;
  counts: { added: number; removed: number };
}

export function RevisionDiff({ rationale, diff, summary, counts }: Props) {
  return (
    <div className="space-y-3">
      <div className="rounded-md border border-current/15 bg-current/5 p-3 text-sm">
        <div className="font-medium">Proposed changes</div>
        <p className="mt-1 opacity-75">{rationale}</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70">
          <li>
            +{counts.added} / -{counts.removed} lines
          </li>
          {summary.leadChanged ? <li>lead changed</li> : null}
          {summary.changedAgents.length > 0 ? (
            <li>{summary.changedAgents.length} agent(s) changed</li>
          ) : null}
          {summary.teamRenamed ? <li>team renamed</li> : null}
          {summary.descriptionChanged ? <li>description changed</li> : null}
        </ul>
        {summary.changedAgents.length > 0 ? (
          <ul className="mt-2 space-y-0.5 text-xs opacity-70">
            {summary.changedAgents.map((c) => (
              <li key={c.agentId ?? c.name}>
                {c.name}: {c.fields.join(', ')}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="max-h-[36rem] overflow-auto rounded-md border border-current/15 font-mono text-xs leading-5">
        {diff.map((line, i) => (
          <div key={i} className={lineClass(line.type)}>
            <span className="select-none opacity-50">{prefix(line.type)} </span>
            {line.text || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}

function prefix(t: DiffLineType): string {
  return t === 'add' ? '+' : t === 'del' ? '-' : ' ';
}

function lineClass(t: DiffLineType): string {
  const base = 'whitespace-pre-wrap px-2';
  if (t === 'add') return `${base} bg-emerald-500/10 text-emerald-800 dark:text-emerald-300`;
  if (t === 'del') return `${base} bg-rose-500/10 text-rose-800 dark:text-rose-300`;
  return `${base} opacity-70`;
}
