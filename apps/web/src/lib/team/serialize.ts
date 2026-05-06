// Team serializers — produce the canonical AGENTS.md and team.json content
// that lands on disk and as snapshots inside TeamRevision rows. Pure functions
// (no I/O). The tool allowlist is single-source — imported from tools/policy.

import { ALLOWED_TOOL_NAMES } from '@lib/tools/policy';

export interface SerializableAgent {
  name: string;
  role: string;
  isLead: boolean;
  modelId: string;
  provider: string;
  systemPrompt: string;
  toolsAllowed: readonly string[];
  tags: readonly string[];
}

export interface SerializableTeam {
  name: string;
  description?: string | null;
  domain?: string | null;
  tags: readonly string[];
}

export interface TeamSnapshot {
  agentsMd: string;
  teamJson: string;
}

export function buildSnapshot(
  team: SerializableTeam,
  agents: readonly SerializableAgent[],
): TeamSnapshot {
  return {
    agentsMd: toAgentsMd(team, agents),
    teamJson: toTeamJson(team, agents),
  };
}

// ----------------------------------------------------------------------------
// AGENTS.md — human-readable export
// ----------------------------------------------------------------------------

export function toAgentsMd(
  team: SerializableTeam,
  agents: readonly SerializableAgent[],
): string {
  const sortedAgents = sortAgents(agents);
  const lines: string[] = [];

  lines.push(`# ${team.name}`);
  if (team.description) lines.push('', team.description);

  lines.push('');
  lines.push('## Team');
  lines.push('');
  if (team.domain) lines.push(`- Domain: ${team.domain}`);
  if (team.tags.length > 0) lines.push(`- Tags: ${team.tags.join(', ')}`);
  lines.push(`- Agents: ${agents.length}`);
  const lead = sortedAgents.find((a) => a.isLead);
  if (lead) lines.push(`- Lead: ${lead.name}`);

  lines.push('');
  lines.push('## Agents');

  for (const a of sortedAgents) {
    lines.push('');
    lines.push(`### ${a.name}${a.isLead ? ' (Lead)' : ''}`);
    lines.push('');
    lines.push(`- Role: ${a.role}`);
    lines.push(`- Model: ${a.modelId} (${a.provider})`);
    if (a.tags.length > 0) lines.push(`- Tags: ${a.tags.join(', ')}`);
    lines.push(`- Tools: ${a.toolsAllowed.length > 0 ? a.toolsAllowed.join(', ') : 'none'}`);
    lines.push('');
    lines.push('#### System prompt');
    lines.push('');
    lines.push('```');
    lines.push(a.systemPrompt.trim());
    lines.push('```');
  }

  lines.push('');
  return lines.join('\n');
}

// ----------------------------------------------------------------------------
// team.json — machine-readable export
// ----------------------------------------------------------------------------

export interface TeamJsonShape {
  schemaVersion: 1;
  team: {
    name: string;
    description: string | null;
    domain: string | null;
    tags: string[];
  };
  agents: Array<{
    name: string;
    role: string;
    isLead: boolean;
    modelId: string;
    provider: string;
    systemPrompt: string;
    toolsAllowed: string[];
    tags: string[];
  }>;
  /** Mirrors `lib/tools/policy.ts:ALLOWED_TOOL_NAMES` at write time. */
  toolAllowlistAtExport: string[];
}

export function toTeamJson(
  team: SerializableTeam,
  agents: readonly SerializableAgent[],
): string {
  const sortedAgents = sortAgents(agents);
  const shape: TeamJsonShape = {
    schemaVersion: 1,
    team: {
      name: team.name,
      description: team.description ?? null,
      domain: team.domain ?? null,
      tags: [...team.tags],
    },
    agents: sortedAgents.map((a) => ({
      name: a.name,
      role: a.role,
      isLead: a.isLead,
      modelId: a.modelId,
      provider: a.provider,
      systemPrompt: a.systemPrompt,
      toolsAllowed: [...a.toolsAllowed],
      tags: [...a.tags],
    })),
    toolAllowlistAtExport: [...ALLOWED_TOOL_NAMES],
  };
  return JSON.stringify(shape, null, 2);
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function sortAgents<T extends { isLead: boolean; name: string }>(
  agents: readonly T[],
): T[] {
  // Lead first, then by name for stability.
  return [...agents].sort((a, b) => {
    if (a.isLead && !b.isLead) return -1;
    if (!a.isLead && b.isLead) return 1;
    return a.name.localeCompare(b.name);
  });
}
