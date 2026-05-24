// Revision proposal validation. Enforces the Phase 5 invariants: the proposed
// agents must be exactly the current roster (same agentId set — no add/remove),
// exactly one lead, tools within the allowlist, required strings non-empty.
// Used by both propose (sanity) and approve (re-validates the client round-trip).

import { ALLOWED_TOOL_NAMES } from '@lib/tools/policy';

const allowlist = new Set<string>(ALLOWED_TOOL_NAMES);

export class RevisionValidationError extends Error {
  constructor(public readonly reason: string) {
    super(`revision_validation_error: ${reason}`);
    this.name = 'RevisionValidationError';
  }
}

export interface ProposedRevisionAgent {
  agentId: string;
  name: string;
  role: string;
  isLead: boolean;
  systemPrompt: string;
  toolsAllowed: string[];
  tags: string[];
  changeReason: string;
}

export interface ProposedRevisionSpec {
  rationale: string;
  teamDescription: string | null;
  agents: ProposedRevisionAgent[];
}

export function validateRevisionProposal(
  raw: unknown,
  currentAgentIds: readonly string[],
): ProposedRevisionSpec {
  if (typeof raw !== 'object' || raw === null) {
    throw new RevisionValidationError('proposal_required');
  }
  const body = raw as { rationale?: unknown; teamDescription?: unknown; agents?: unknown };

  const rationale =
    typeof body.rationale === 'string' && body.rationale.trim().length > 0
      ? body.rationale.trim()
      : 'team revision';
  const teamDescription =
    typeof body.teamDescription === 'string' ? body.teamDescription : null;

  if (!Array.isArray(body.agents)) {
    throw new RevisionValidationError('agents_required');
  }
  const expected = new Set(currentAgentIds);
  if (body.agents.length !== expected.size) {
    throw new RevisionValidationError('agent_count_mismatch');
  }

  const seen = new Set<string>();
  let leadCount = 0;
  const agents: ProposedRevisionAgent[] = [];

  for (const entry of body.agents as Array<Record<string, unknown>>) {
    if (typeof entry?.agentId !== 'string' || !expected.has(entry.agentId)) {
      throw new RevisionValidationError('agent_id_unknown');
    }
    if (seen.has(entry.agentId)) throw new RevisionValidationError('agent_id_duplicate');
    seen.add(entry.agentId);

    if (typeof entry.name !== 'string' || entry.name.trim().length === 0) {
      throw new RevisionValidationError('name_required');
    }
    if (typeof entry.role !== 'string' || entry.role.trim().length === 0) {
      throw new RevisionValidationError('role_required');
    }
    if (typeof entry.systemPrompt !== 'string' || entry.systemPrompt.trim().length === 0) {
      throw new RevisionValidationError('system_prompt_required');
    }
    if (typeof entry.isLead !== 'boolean') {
      throw new RevisionValidationError('is_lead_required');
    }
    if (!Array.isArray(entry.toolsAllowed)) {
      throw new RevisionValidationError('tools_required');
    }
    const tools: string[] = [];
    for (const t of entry.toolsAllowed) {
      if (typeof t !== 'string' || !allowlist.has(t)) {
        throw new RevisionValidationError('tool_not_in_allowlist');
      }
      tools.push(t);
    }
    const tags = Array.isArray(entry.tags)
      ? (entry.tags as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];

    if (entry.isLead) leadCount += 1;
    agents.push({
      agentId: entry.agentId,
      name: entry.name.trim(),
      role: entry.role.trim(),
      isLead: entry.isLead,
      systemPrompt: entry.systemPrompt,
      toolsAllowed: tools,
      tags,
      changeReason: typeof entry.changeReason === 'string' ? entry.changeReason : '',
    });
  }

  if (seen.size !== expected.size) {
    throw new RevisionValidationError('agent_set_mismatch');
  }
  if (leadCount !== 1) {
    throw new RevisionValidationError('exactly_one_lead_required');
  }

  return { rationale, teamDescription, agents };
}
