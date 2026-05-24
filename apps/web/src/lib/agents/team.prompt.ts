// Team proposal prompt builders + Zod schemas. The LLM proposes structure
// (name, agents, roles, hints) — the server decides exact model IDs and
// validates the tool allowlist. We keep the tool allowlist single-source by
// importing it from lib/tools/policy.ts.

import { z } from 'zod';

import { ALLOWED_TOOL_NAMES } from '@lib/tools/policy';

export const MODEL_HINTS = ['fast', 'standard', 'premium', 'local'] as const;
export type ModelHint = (typeof MODEL_HINTS)[number];

export const TEAM_AGENT_COUNT = 5;

const allowedToolNamesSet = new Set<string>(ALLOWED_TOOL_NAMES);

const agentSchema = z.object({
  name: z.string().min(1).max(80),
  role: z.string().min(1).max(160),
  isLead: z.boolean(),
  systemPrompt: z.string().min(1).max(2000),
  modelHint: z.enum(MODEL_HINTS),
  toolsAllowed: z
    .array(z.string())
    .max(ALLOWED_TOOL_NAMES.length)
    .refine((tools) => tools.every((t) => allowedToolNamesSet.has(t)), {
      message: 'tool name not in MVP allowlist',
    }),
  tags: z.array(z.string().min(1).max(40)).max(10),
});

export const teamProposalSchema = z
  .object({
    name: z.string().min(1).max(120),
    description: z.string().max(400).optional(),
    domain: z.string().max(80).optional(),
    tags: z.array(z.string().min(1).max(40)).max(10),
    agents: z.array(agentSchema).length(TEAM_AGENT_COUNT),
  })
  .refine((proposal) => proposal.agents.filter((a) => a.isLead).length === 1, {
    message: 'team must have exactly one lead agent',
    path: ['agents'],
  });

export type TeamProposalPayload = z.infer<typeof teamProposalSchema>;
export type ProposedAgent = TeamProposalPayload['agents'][number];

const SYSTEM_TEAM_PROPOSAL = `You are the Team Architect Agent for the Harness Agents app.
After the Product-Owner Agent finishes Q&A, you propose a complete agent team for the request.

Hard rules:
- Exactly ${TEAM_AGENT_COUNT} agents, with exactly 1 lead (isLead=true). The lead orchestrates the others.
- Each agent has a clear, distinct role (no two agents covering the same scope).
- modelHint is one of: 'fast' (cheap fast tasks), 'standard' (balanced default), 'premium' (heavy reasoning), 'local' (offline/Ollama).
- toolsAllowed is a SUBSET of: ${ALLOWED_TOOL_NAMES.join(', ')}.
  - Only the agents that need a tool should request it.
  - Most agents need no tools.
- systemPrompt is concise and operational (<=2000 chars). Speak in second person to the agent.
- Return ONLY the structured shape requested.`;

const STRICT_REPAIR_SUFFIX = `STRICT REPAIR MODE — your previous response did NOT match the required schema. Follow these rules without exception:
- Return ONLY the structured object. Do not include markdown or commentary.
- Output exactly ${TEAM_AGENT_COUNT} agents.
- Output exactly one lead (one agent with isLead=true; all other agents must have isLead=false).
- Use only allowed tools from this allowlist: ${ALLOWED_TOOL_NAMES.join(', ')}. Use an empty array if the agent needs none.
- modelHint must be one of: 'fast', 'standard', 'premium', 'local'.
- All required string fields must be non-empty.`;

export interface TeamPromptInput {
  userPrompt: string;
  historyLines: string[];
  /** When true, append strict-repair guidance — used for the automatic retry after a schema error. */
  strict?: boolean;
}

export function buildTeamProposalMessages(input: TeamPromptInput) {
  const lines = [
    `User prompt: ${input.userPrompt}`,
    '',
    'Prior PO Q&A:',
    ...(input.historyLines.length ? input.historyLines : ['(none)']),
    '',
    `Compose a ${TEAM_AGENT_COUNT}-agent team that can deliver the user request.`,
    'Pick an appropriate domain label (1-2 words) and a small set of tags (<=5).',
    'Choose a modelHint per agent based on their role. Keep tool requests minimal.',
  ];
  if (input.strict) {
    lines.push('', STRICT_REPAIR_SUFFIX);
  }
  const systemContent = input.strict
    ? `${SYSTEM_TEAM_PROPOSAL}\n\n${STRICT_REPAIR_SUFFIX}`
    : SYSTEM_TEAM_PROPOSAL;
  return [
    { role: 'system' as const, content: systemContent },
    { role: 'user' as const, content: lines.join('\n') },
  ];
}
