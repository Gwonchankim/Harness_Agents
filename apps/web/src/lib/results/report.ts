// Run report builder (pure). Produces report.md — the "what happened" execution
// report, distinct from result.md (the deliverable synthesis built by
// finalResult.ts). No I/O here; the exporter and the feedback page both call this.

import { rollupTaskAttempts, type AttemptSummaryRow } from './attemptSummary';

export interface ReportTaskInput {
  taskKey: string;
  title: string;
  agentName: string;
  status: string;
  durationMs: number | null;
  outputBytes: number | null;
  error: string | null;
  /** Phase 14: optional per-attempt summary rows (no resultText). Omitted for historical runs. */
  attempts?: AttemptSummaryRow[];
}

export interface ReportAgentInput {
  name: string;
  role: string;
  modelId: string;
  provider: string;
  isLead: boolean;
}

export interface RunReportInput {
  runId: string;
  userPrompt: string;
  teamName: string;
  status: string;
  rationale: string | null;
  agents: ReportAgentInput[];
  tasks: ReportTaskInput[];
  startedAt: string | null; // ISO
  endedAt: string | null; // ISO
}

export function buildRunReportMarkdown(input: RunReportInput): string {
  const lead = input.agents.find((a) => a.isLead) ?? null;
  const succeeded = input.tasks.filter((t) => t.status === 'done').length;
  const failed = input.tasks.filter((t) => t.status === 'failed').length;
  const totalDuration = elapsed(input.startedAt, input.endedAt);

  const lines: string[] = [
    `# Run report — ${input.teamName}`,
    '',
    '## Overview',
    '',
    `- Status: ${input.status}`,
    `- Team: ${input.teamName}`,
    `- Lead: ${lead ? lead.name : '—'}`,
    `- Agents: ${input.agents.length}`,
    `- Tasks: ${input.tasks.length} (${succeeded} done, ${failed} failed)`,
    `- Duration: ${totalDuration}`,
    '',
    '### Request',
    '',
    input.userPrompt.trim() || '(empty prompt)',
    '',
    '### Team roster',
    '',
  ];

  for (const a of input.agents) {
    lines.push(`- ${a.name}${a.isLead ? ' (Lead)' : ''} — ${a.role} · ${a.modelId} (${a.provider})`);
  }

  lines.push('', '## Plan rationale', '', input.rationale?.trim() || '(no rationale recorded)');

  const hasAnyAttempts = input.tasks.some((t) => (t.attempts?.length ?? 0) > 0);

  lines.push('', '## Task timeline', '');
  if (input.tasks.length === 0) {
    lines.push('No tasks were recorded for this run.');
  } else if (hasAnyAttempts) {
    lines.push('| # | Task key | Agent | Status | Attempts | Duration | Output bytes |');
    lines.push('|---|---|---|---|---|---|---|');
    input.tasks.forEach((t, i) => {
      const attemptCount = t.attempts?.length ? String(t.attempts.length) : '—';
      lines.push(
        `| ${i + 1} | \`${t.taskKey}\` | ${t.agentName} | ${t.status} | ${attemptCount} | ${formatMs(
          t.durationMs,
        )} | ${t.outputBytes ?? '—'} |`,
      );
    });
  } else {
    lines.push('| # | Task key | Agent | Status | Duration | Output bytes |');
    lines.push('|---|---|---|---|---|---|');
    input.tasks.forEach((t, i) => {
      lines.push(
        `| ${i + 1} | \`${t.taskKey}\` | ${t.agentName} | ${t.status} | ${formatMs(
          t.durationMs,
        )} | ${t.outputBytes ?? '—'} |`,
      );
    });
  }

  const failures = input.tasks.filter((t) => t.status === 'failed' && t.error);
  if (failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const f of failures) {
      lines.push(`- \`${f.taskKey}\` (${f.agentName}): ${f.error}`);
    }
  }

  if (hasAnyAttempts) {
    lines.push('', '## Attempt summary', '');
    const withAttempts = input.tasks.filter((t) => (t.attempts?.length ?? 0) > 0);
    const totalAttempts = withAttempts.reduce((s, t) => s + (t.attempts?.length ?? 0), 0);
    lines.push(`- Total attempts: ${totalAttempts} across ${withAttempts.length} task(s).`);
    const notable = withAttempts
      .map((t) => ({ t, r: rollupTaskAttempts(t.attempts ?? []) }))
      .filter(({ r }) => r.count > 1 || r.reran || r.resumed || r.autoResumed || r.failedCount > 0);
    if (notable.length === 0) {
      lines.push('- All tasks completed on their first attempt.');
    } else {
      for (const { t, r } of notable) {
        const flags = [
          `${r.count} attempts`,
          r.reran ? 'rerun_from_task' : null,
          r.resumed ? 'resume' : null,
          r.autoResumed ? 'auto_resume' : null,
          r.failedCount > 0 ? `${r.failedCount} failed/cancelled` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        lines.push(
          `- \`${t.taskKey}\` (${t.agentName}): ${flags} — latest ${r.latestStatus ?? '—'} via ${r.latestSource ?? '—'}`,
        );
      }
    }
  }

  lines.push(
    '',
    '## Outputs',
    '',
    '- Deliverable: `result.md`',
    '- Per-agent detail: `agent-reports/{agentId}.md`',
    '',
    '---',
    `Generated from Run ${input.runId}.`,
  );

  return `${lines.join('\n')}\n`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function elapsed(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '—';
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
  return formatMs(end - start);
}
