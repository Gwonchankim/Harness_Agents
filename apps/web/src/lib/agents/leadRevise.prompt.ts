// Lead revision prompt + Zod schema. The Lead reads run feedback + result and
// proposes IMPROVEMENTS to the existing agents. Phase 5 keeps the roster fixed:
// the Lead must echo each agent's existing agentId and may not add/remove agents
// or change models (model changes are out of scope — handled by team-models).

import type { CoreMessage } from 'ai';
import { z } from 'zod';

import { ALLOWED_TOOL_NAMES } from '@lib/tools/policy';

const allowedToolNamesSet = new Set<string>(ALLOWED_TOOL_NAMES);

const revisedAgentSchema = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1).max(80),
  role: z.string().min(1).max(160),
  isLead: z.boolean(),
  systemPrompt: z.string().min(1).max(2000),
  toolsAllowed: z
    .array(z.string())
    .max(ALLOWED_TOOL_NAMES.length)
    .refine((tools) => tools.every((t) => allowedToolNamesSet.has(t)), {
      message: 'tool name not in MVP allowlist',
    }),
  tags: z.array(z.string().min(1).max(40)).max(10),
  changeReason: z.string().max(400),
});

export const teamRevisionSchema = z
  .object({
    rationale: z.string().min(1).max(800),
    teamDescription: z.string().max(400).optional(),
    agents: z.array(revisedAgentSchema).min(1).max(12),
  })
  .refine((p) => p.agents.filter((a) => a.isLead).length === 1, {
    message: 'team must have exactly one lead agent',
    path: ['agents'],
  });

export type TeamRevisionPayload = z.infer<typeof teamRevisionSchema>;
export type RevisedAgent = TeamRevisionPayload['agents'][number];

export interface CurrentAgentForPrompt {
  agentId: string;
  name: string;
  role: string;
  isLead: boolean;
  systemPrompt: string;
  toolsAllowed: string[];
  tags: string[];
  outputExcerpt: string;
}

export interface AgentFeedbackForPrompt {
  agentId: string;
  name: string;
  rating: number | null;
  comment: string | null;
}

export interface LeadRevisePromptInput {
  teamName: string;
  teamDescription: string | null;
  userPrompt: string;
  resultExcerpt: string;
  resultRating: number | null;
  resultComment: string | null;
  currentAgents: CurrentAgentForPrompt[];
  agentFeedback: AgentFeedbackForPrompt[];
  strict?: boolean;
}

const SYSTEM_LEAD_REVISE = `You are the Lead Agent improving your own team after a completed run.
You receive the original request, the produced result, and the user's feedback.
You propose an improved version of EACH existing agent.

Hard rules:
- Keep the exact same roster: echo every agent's "agentId" unchanged. Do NOT add or remove agents.
- Do NOT change models — model selection is out of scope here.
- Exactly one agent must have isLead=true.
- toolsAllowed must be a subset of the MVP allowlist.
- Improve role/systemPrompt/tools/tags where feedback justifies it; otherwise keep them.
- Make large changes ONLY when feedback is clearly negative or explicit.
- changeReason: one short sentence per agent (use "no change" when unchanged).
- systemPrompt stays concise and operational (<=2000 chars), second person.
- Return ONLY the structured shape requested.`;

const STRICT_REPAIR_SUFFIX = `STRICT REPAIR MODE — your previous response did NOT match the required schema. Without exception:
- Return ONLY the structured object (no markdown, no commentary).
- Echo the SAME set of agentId values you were given — no additions, no removals.
- Exactly one agent has isLead=true; all others isLead=false.
- toolsAllowed contains only allowlisted tool names (empty array if none).
- Every string field is non-empty (changeReason may be "no change").`;

export function buildLeadReviseMessages(input: LeadRevisePromptInput): CoreMessage[] {
  const lines: string[] = [
    `Team: ${input.teamName}`,
    input.teamDescription ? `Description: ${input.teamDescription}` : 'Description: (none)',
    '',
    `Original request: ${input.userPrompt}`,
    '',
    `Result rating (1-5): ${input.resultRating ?? 'n/a'}`,
    `Result comment: ${input.resultComment ?? '(none)'}`,
    '',
    'Result excerpt:',
    input.resultExcerpt.trim() || '(none)',
    '',
    'Current agents (echo each agentId exactly):',
  ];

  const feedbackByAgent = new Map(input.agentFeedback.map((f) => [f.agentId, f] as const));
  for (const a of input.currentAgents) {
    const fb = feedbackByAgent.get(a.agentId);
    lines.push(
      '',
      `- agentId: ${a.agentId}`,
      `  name: ${a.name}${a.isLead ? ' (Lead)' : ''}`,
      `  role: ${a.role}`,
      `  tools: ${a.toolsAllowed.length ? a.toolsAllowed.join(', ') : 'none'}`,
      `  tags: ${a.tags.length ? a.tags.join(', ') : 'none'}`,
      `  feedback: ${fb ? `rating ${fb.rating ?? 'n/a'} — ${fb.comment ?? '(no comment)'}` : '(none)'}`,
      `  output excerpt: ${a.outputExcerpt.trim() || '(none)'}`,
    );
  }

  lines.push('', 'Propose an improved version of each agent. Keep the roster and models fixed.');
  if (input.strict) lines.push('', STRICT_REPAIR_SUFFIX);

  const systemContent = input.strict
    ? `${SYSTEM_LEAD_REVISE}\n\n${STRICT_REPAIR_SUFFIX}`
    : SYSTEM_LEAD_REVISE;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: lines.join('\n') },
  ];
}
