// Dependency-free line diff (LCS) + a structured team-change summary. Pure
// functions — no npm diff library (per the Phase 3 "no diff dependencies"
// decision). Consumed by the revision proposal flow and the RevisionDiff viewer.

export type DiffLineType = 'add' | 'del' | 'ctx';

export interface DiffLine {
  type: DiffLineType;
  text: string;
}

/**
 * Unified line diff between `before` and `after`. Uses an LCS table, so the
 * result is the minimal-ish edit script: shared lines are `ctx`, removed lines
 * `del`, added lines `add`. O(n*m) — fine for AGENTS.md-sized inputs.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;

  // dp[i][j] = LCS length of a[i..], b[j..].
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'ctx', text: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ type: 'del', text: a[i]! });
      i++;
    } else {
      out.push({ type: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: 'del', text: a[i]! });
    i++;
  }
  while (j < m) {
    out.push({ type: 'add', text: b[j]! });
    j++;
  }
  return out;
}

export function countDiff(lines: readonly DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.type === 'add') added++;
    else if (l.type === 'del') removed++;
  }
  return { added, removed };
}

// ----------------------------------------------------------------------------
// Structured team-change summary (top-of-diff overview)
// ----------------------------------------------------------------------------

export interface DiffAgent {
  agentId?: string | null;
  name: string;
  isLead: boolean;
  role: string;
  systemPrompt: string;
  toolsAllowed: string[];
  tags: string[];
}

export interface DiffTeamSpec {
  name: string;
  description: string | null;
  agents: DiffAgent[];
}

export interface AgentChange {
  agentId: string | null;
  name: string;
  fields: string[];
}

export interface TeamChangeSummary {
  teamRenamed: boolean;
  descriptionChanged: boolean;
  leadChanged: boolean;
  changedAgents: AgentChange[];
  addedAgents: string[];
  removedAgents: string[];
}

/**
 * Match agents by `agentId` when present (Phase 5 keeps agentIds stable), else by
 * name, and report which fields changed. In Phase 5 add/removed are expected to
 * be empty, but the function stays general.
 */
export function summarizeTeamChanges(
  before: DiffTeamSpec,
  after: DiffTeamSpec,
): TeamChangeSummary {
  const keyOf = (a: DiffAgent): string => a.agentId ?? `name:${a.name}`;
  const beforeByKey = new Map(before.agents.map((a) => [keyOf(a), a] as const));
  const afterByKey = new Map(after.agents.map((a) => [keyOf(a), a] as const));

  const changedAgents: AgentChange[] = [];
  for (const [key, beforeAgent] of beforeByKey) {
    const afterAgent = afterByKey.get(key);
    if (!afterAgent) continue;
    const fields = changedFields(beforeAgent, afterAgent);
    if (fields.length > 0) {
      changedAgents.push({ agentId: beforeAgent.agentId ?? null, name: afterAgent.name, fields });
    }
  }

  const addedAgents = [...afterByKey.keys()]
    .filter((k) => !beforeByKey.has(k))
    .map((k) => afterByKey.get(k)!.name);
  const removedAgents = [...beforeByKey.keys()]
    .filter((k) => !afterByKey.has(k))
    .map((k) => beforeByKey.get(k)!.name);

  const beforeLead = before.agents.find((a) => a.isLead)?.name ?? null;
  const afterLead = after.agents.find((a) => a.isLead)?.name ?? null;

  return {
    teamRenamed: before.name !== after.name,
    descriptionChanged: (before.description ?? '') !== (after.description ?? ''),
    leadChanged: beforeLead !== afterLead,
    changedAgents,
    addedAgents,
    removedAgents,
  };
}

function changedFields(a: DiffAgent, b: DiffAgent): string[] {
  const fields: string[] = [];
  if (a.name !== b.name) fields.push('name');
  if (a.role !== b.role) fields.push('role');
  if (a.isLead !== b.isLead) fields.push('isLead');
  if (a.systemPrompt !== b.systemPrompt) fields.push('systemPrompt');
  if (!sameSet(a.toolsAllowed, b.toolsAllowed)) fields.push('toolsAllowed');
  if (!sameSet(a.tags, b.tags)) fields.push('tags');
  return fields;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
