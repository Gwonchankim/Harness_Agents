// Lead Agent prompt + Zod schema for the ExecutionPlan DAG. The Lead picks task
// keys, agent assignments, and dependencies. Tools are explicitly NOT available
// in Phase 4 — every task is a single-shot agent invocation.

import { z } from 'zod';

export const LEAD_TASK_KEY_PATTERN = /^[a-z][a-z0-9_-]{0,40}$/;
export const LEAD_MAX_TASKS = 12;

const taskSchema = z.object({
  taskKey: z.string().regex(LEAD_TASK_KEY_PATTERN),
  assignedAgentName: z.string().min(1).max(80),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1500),
  expectedOutput: z.string().min(1).max(400),
  dependencies: z.array(z.string().regex(LEAD_TASK_KEY_PATTERN)).max(8),
});

export const executionPlanSchema = z.object({
  rationale: z.string().min(1).max(800),
  tasks: z.array(taskSchema).min(1).max(LEAD_MAX_TASKS),
});

export type ExecutionPlanPayload = z.infer<typeof executionPlanSchema>;
export type ExecutionPlanTask = ExecutionPlanPayload['tasks'][number];

export interface LeadPromptAgent {
  name: string;
  role: string;
  modelLabel: string;
  isLead: boolean;
}

export interface LeadPromptInput {
  userPrompt: string;
  historyLines: string[];
  teamName: string;
  teamDescription?: string | null;
  agents: LeadPromptAgent[];
}

const SYSTEM_LEAD = `You are the Lead Agent for the Harness Agents app.
You design an execution DAG to fulfill the user's request using the team you lead.

Hard rules:
- Produce 1..${LEAD_MAX_TASKS} tasks. Each task is sized for a single agent invocation.
- assignedAgentName MUST match exactly one of the team agents listed below (case-sensitive).
- The Lead does NOT execute tasks. The Lead may NOT assign tasks to itself.
- Tools are NOT available in this MVP. Tasks must be solvable from text reasoning over the prompt and prior tasks' results.
- dependencies references prior taskKeys only. No cycles, no self-references.
- expectedOutput is concrete and verifiable (e.g. "200-word summary", "markdown checklist of N items").
- taskKey is a short lowercase ASCII slug (kebab or snake), unique within the plan.
- Return ONLY the structured shape requested. No commentary outside the fields.`;

export function buildLeadPlanMessages(input: LeadPromptInput) {
  const lines: string[] = [`Team: ${input.teamName}`];
  if (input.teamDescription) lines.push(`Description: ${input.teamDescription}`);
  lines.push('');
  lines.push('Team agents:');
  for (const a of input.agents) {
    lines.push(
      `- ${a.name}${a.isLead ? ' (Lead — do not assign)' : ''} · ${a.role} · model: ${a.modelLabel}`,
    );
  }
  lines.push('');
  lines.push(`User prompt: ${input.userPrompt}`);
  lines.push('');
  lines.push('Prior PO Q&A:');
  if (input.historyLines.length > 0) {
    for (const h of input.historyLines) lines.push(h);
  } else {
    lines.push('(none)');
  }
  lines.push('');
  lines.push('Plan an execution DAG that delivers the user request.');
  return [
    { role: 'system' as const, content: SYSTEM_LEAD },
    { role: 'user' as const, content: lines.join('\n') },
  ];
}
