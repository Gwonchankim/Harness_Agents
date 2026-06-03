// Phase 20: pure, read-only RunEvent-link audit for the dry-run cleanup planner.
// Given a run's artifact rows + an authoritative (full-DB) RunEvent link count
// per artifactId, it reports — per (kind, path) group and run-level — how many
// older (non-latest) metadata rows a future keep-latest cleanup would drop and
// how many RunEvent links would be set to NULL. It NEVER mutates, deletes, or
// queries anything (the route supplies the counts; Phase 21+ does any cleanup).
//
// Only result.created events carry an artifactId (executor.ts), so non-result
// kinds simply have no entries in the count map → linkedEventsAffected 0.

import { groupArtifactHistory, type ArtifactRow } from './artifactList';

export interface CleanupCandidateGroup {
  kind: string;
  path: string;
  latestId: string;
  candidateIds: string[]; // non-latest row ids (newest-first, latest excluded)
}

export interface CleanupCandidates {
  groups: CleanupCandidateGroup[];
  allCandidateIds: string[]; // flat union — the route feeds this to groupBy where:{ in }
}

/**
 * Identify per-(kind, path) cleanup candidates from a run's artifact rows.
 * Reuses groupArtifactHistory (newest-first, createdAt desc / id desc) so the
 * kept-latest row matches selectLatestArtifacts exactly. Pure; input unchanged.
 */
export function selectCleanupCandidates(rows: readonly ArtifactRow[]): CleanupCandidates {
  const groups = groupArtifactHistory(rows).map((g) => ({
    kind: g.kind,
    path: g.path,
    latestId: g.latest.id,
    candidateIds: g.versions.slice(1).map((v) => v.id), // everything but the latest
  }));
  const allCandidateIds = groups.flatMap((g) => g.candidateIds);
  return { groups, allCandidateIds };
}

export interface LinkAuditGroup {
  kind: string;
  path: string;
  latestId: string;
  candidateCount: number;
  linkedEventsAffected: number;
  candidateIds: string[]; // kept for Phase 21 reuse / tests; the route omits it from its JSON
}

export interface LinkAuditSummary {
  totalGroups: number; // distinct (kind, path) groups
  cleanupCandidateRows: number; // Σ non-latest rows across groups
  affectedGroups: number; // groups with ≥1 non-latest row
  fullAuditLinkedEvents: number; // Σ RunEvent links on non-latest rows (authoritative)
}

export interface LinkAudit {
  summary: LinkAuditSummary;
  groups: LinkAuditGroup[];
}

/**
 * Fold the candidate groups + an authoritative link-count map (artifactId →
 * count of referencing RunEvents) into per-group and run-level audit numbers.
 * A candidate id absent from the map contributes 0 (non-result kinds, no links).
 * Pure; does not mutate the inputs.
 */
export function buildLinkAudit(
  groups: readonly CleanupCandidateGroup[],
  linkCountByArtifactId: ReadonlyMap<string, number>,
): LinkAudit {
  let cleanupCandidateRows = 0;
  let affectedGroups = 0;
  let fullAuditLinkedEvents = 0;

  const out: LinkAuditGroup[] = groups.map((g) => {
    let linkedEventsAffected = 0;
    for (const id of g.candidateIds) {
      linkedEventsAffected += linkCountByArtifactId.get(id) ?? 0;
    }
    cleanupCandidateRows += g.candidateIds.length;
    if (g.candidateIds.length > 0) affectedGroups += 1;
    fullAuditLinkedEvents += linkedEventsAffected;
    return {
      kind: g.kind,
      path: g.path,
      latestId: g.latestId,
      candidateCount: g.candidateIds.length,
      linkedEventsAffected,
      candidateIds: g.candidateIds,
    };
  });

  return {
    summary: {
      totalGroups: groups.length,
      cleanupCandidateRows,
      affectedGroups,
      fullAuditLinkedEvents,
    },
    groups: out,
  };
}
