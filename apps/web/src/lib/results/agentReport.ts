// Per-agent report builder (pure). Produces agent-reports/{agentId}.md content.
// One file per agent that had at least one task in the run. No I/O here.

export interface AgentReportTaskInput {
  taskKey: string;
  title: string;
  description: string;
  expectedOutput: string | null;
  status: string;
  durationMs: number | null;
  text: string;
  error: string | null;
}

export interface AgentReportInput {
  agentId: string;
  agentName: string;
  role: string;
  modelId: string;
  provider: string;
  isLead: boolean;
  tasks: AgentReportTaskInput[];
}

export function buildAgentReportMarkdown(input: AgentReportInput): string {
  const lines: string[] = [
    `# ${input.agentName}${input.isLead ? ' (Lead)' : ''} — agent report`,
    '',
    '## Profile',
    '',
    `- Role: ${input.role}`,
    `- Model: ${input.modelId} (${input.provider})`,
    `- Tasks: ${input.tasks.length}`,
  ];

  if (input.tasks.length === 0) {
    lines.push('', 'This agent was not assigned any tasks in this run.');
    return `${lines.join('\n')}\n`;
  }

  lines.push('', '## Tasks');
  for (const t of input.tasks) {
    lines.push(
      '',
      `### ${t.title}`,
      '',
      `- Task: \`${t.taskKey}\``,
      `- Status: ${t.status}`,
      `- Duration: ${formatMs(t.durationMs)}`,
      '',
      '#### Description',
      '',
      t.description.trim() || '(none)',
    );
    if (t.expectedOutput) {
      lines.push('', '#### Expected output', '', t.expectedOutput.trim());
    }
    if (t.error) {
      lines.push('', '#### Error', '', t.error.trim());
    }
    lines.push('', '#### Output', '', t.text.trim() || '(no output recorded)');
  }

  return `${lines.join('\n')}\n`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
