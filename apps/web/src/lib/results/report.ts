// Run report builder (pure). Produces report.md — the "what happened" execution
// report, distinct from result.md (the deliverable synthesis built by
// finalResult.ts). No I/O here; the exporter and the feedback page both call this.

export interface ReportTaskInput {
  taskKey: string;
  title: string;
  agentName: string;
  status: string;
  durationMs: number | null;
  outputBytes: number | null;
  error: string | null;
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

  lines.push('', '## Task timeline', '');
  if (input.tasks.length === 0) {
    lines.push('No tasks were recorded for this run.');
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
