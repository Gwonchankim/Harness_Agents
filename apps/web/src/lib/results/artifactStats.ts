// Phase 18: pure, read-only artifact redundancy stats. Artifact rows are
// append-only (a new row per re-export), so a (kind, path) group accumulates
// versions while only the latest file survives on disk. These helpers turn the
// rows the run loader already holds into non-destructive visibility metrics —
// they never mutate, delete, or query anything.

import type { ArtifactRow } from './artifactList';

// Group key — identical to selectLatestArtifacts / groupArtifactHistory so the
// counts line up exactly with the latest-selection used elsewhere.
function groupKey(kind: string, path: string): string {
  return `${kind} ${path}`;
}

export interface GroupVersionStats {
  versionCount: number; // total append-only rows for this (kind, path)
  redundantCount: number; // max(0, versionCount - 1)
  // Optional sha256 breakdown — only present when the group has ≥1 non-null
  // sha256 (older rows may predate sha tracking). Rows with null sha256 are
  // excluded from both counts.
  changedVersionCount?: number; // distinct non-null sha256 values (genuinely different contents)
  sameContentCount?: number; // non-null rows beyond the first of each sha (byte-identical re-exports)
}

/**
 * Count versions per (kind, path) group from the raw (un-deduped) rows the run
 * loader already fetched. Pure; does not mutate the input.
 */
export function countVersionsByGroup(
  rows: readonly ArtifactRow[],
): Map<string, GroupVersionStats> {
  // key -> { versionCount, sha freq map, nonNull count }
  const acc = new Map<string, { versionCount: number; shaFreq: Map<string, number>; nonNull: number }>();
  for (const r of rows) {
    const key = groupKey(r.kind, r.path);
    let g = acc.get(key);
    if (!g) {
      g = { versionCount: 0, shaFreq: new Map(), nonNull: 0 };
      acc.set(key, g);
    }
    g.versionCount += 1;
    if (r.sha256 !== null) {
      g.nonNull += 1;
      g.shaFreq.set(r.sha256, (g.shaFreq.get(r.sha256) ?? 0) + 1);
    }
  }

  const out = new Map<string, GroupVersionStats>();
  for (const [key, g] of acc) {
    const stats: GroupVersionStats = {
      versionCount: g.versionCount,
      redundantCount: Math.max(0, g.versionCount - 1),
    };
    if (g.nonNull > 0) {
      stats.changedVersionCount = g.shaFreq.size; // distinct contents
      stats.sameContentCount = g.nonNull - g.shaFreq.size; // byte-identical extras
    }
    out.set(key, stats);
  }
  return out;
}

export interface RedundancySummary {
  groups: number; // distinct (kind, path) groups
  totalVersions: number; // sum of versionCount across groups
  redundant: number; // sum of redundantCount across groups
  redundancyPct: number; // redundant / totalVersions * 100, 1 decimal (0 when empty)
  byKind: Record<string, { groups: number; versions: number; redundant: number }>;
}

/**
 * Run-level redundancy summary from the deduped latest-per-group metadata
 * (each carrying versionCount). Pure; does not mutate the input. A missing
 * versionCount is treated as 1 (single version, no redundancy).
 */
export function summarizeRedundancy(
  metas: readonly Readonly<{ kind: string; versionCount?: number }>[],
): RedundancySummary {
  let totalVersions = 0;
  let redundant = 0;
  const byKind: Record<string, { groups: number; versions: number; redundant: number }> = {};

  for (const m of metas) {
    const versions = m.versionCount ?? 1;
    const red = Math.max(0, versions - 1);
    totalVersions += versions;
    redundant += red;
    const k = (byKind[m.kind] ??= { groups: 0, versions: 0, redundant: 0 });
    k.groups += 1;
    k.versions += versions;
    k.redundant += red;
  }

  const redundancyPct = totalVersions > 0 ? Math.round((redundant / totalVersions) * 1000) / 10 : 0;
  return { groups: metas.length, totalVersions, redundant, redundancyPct, byKind };
}
