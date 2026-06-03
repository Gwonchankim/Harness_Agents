// Phase 19: pure, read-only dry-run cleanup planner. Computes what a FUTURE
// keep-latest cleanup WOULD remove from the append-only Artifact rows — counts,
// represented historical bytes, and loaded RunEvent link impact. It NEVER
// mutates, deletes, upserts, or queries anything (Phase 20+ would perform any
// actual cleanup).
//
// NOTE on "represented historical bytes": this is the summed file-size metadata
// of the older (non-latest) rows. It is NOT reclaimable disk space — writers
// overwrite the same path, so past versions' files are already gone; only the
// DB metadata rows remain. So this measures a "DB metadata cleanup candidate",
// not freed disk space.

// Minimal structural shape shared by ArtifactRow (lib) and the history
// ArtifactVersion (UI) — both carry id / bytes / sha256.
export interface CleanupVersion {
  id: string;
  bytes: number;
  sha256: string | null;
}

export interface GroupCleanupPlan {
  keepLatestId: string | null; // the row kept (latest); null only for empty input
  olderRows: number; // non-latest metadata rows a cleanup would remove
  representedHistoricalBytes: number; // summed bytes of the older metadata rows
  // sha256 breakdown over the OLDER rows only (present when ≥1 older row has a
  // non-null sha256; null-sha rows are excluded from the breakdown):
  changedVersions?: number; // distinct non-null sha among older rows (genuinely different)
  sameContentRows?: number; // older non-null rows beyond the first of each sha (byte-identical)
  loadedLinkedEventsAffected: number; // older row ids referenced by loaded RunEvent links
}

// `versions` MUST be newest-first (createdAt desc, id desc) — exactly how
// groupArtifactHistory / loadArtifactHistory return them. versions[0] is kept.
export function planGroupCleanup(
  versions: readonly CleanupVersion[],
  linkedArtifactIds?: ReadonlySet<string>,
): GroupCleanupPlan {
  if (versions.length === 0) {
    return {
      keepLatestId: null,
      olderRows: 0,
      representedHistoricalBytes: 0,
      loadedLinkedEventsAffected: 0,
    };
  }
  const keepLatestId = versions[0]!.id;
  const older = versions.slice(1);

  let representedHistoricalBytes = 0;
  let loadedLinkedEventsAffected = 0;
  const shaFreq = new Map<string, number>();
  let nonNull = 0;
  for (const v of older) {
    representedHistoricalBytes += v.bytes;
    if (linkedArtifactIds?.has(v.id)) loadedLinkedEventsAffected += 1;
    if (v.sha256 !== null) {
      nonNull += 1;
      shaFreq.set(v.sha256, (shaFreq.get(v.sha256) ?? 0) + 1);
    }
  }

  const plan: GroupCleanupPlan = {
    keepLatestId,
    olderRows: older.length,
    representedHistoricalBytes,
    loadedLinkedEventsAffected,
  };
  if (nonNull > 0) {
    plan.changedVersions = shaFreq.size; // distinct contents among older rows
    plan.sameContentRows = nonNull - shaFreq.size; // byte-identical extras
  }
  return plan;
}

export interface CleanupPlanSummary {
  totalGroups: number;
  cleanupCandidateRows: number; // Σ older (non-latest) rows across groups
  affectedGroups: number; // groups with more than one version
  representedHistoricalBytes: number; // Σ represented historical bytes
  loadedLinkedEventsAffected: number; // loaded linked artifact ids that are NOT a kept-latest id
}

/**
 * Run-level dry-run summary from the deduped latest-per-group metadata (each
 * carrying versionCount + representedHistoricalBytes) and the set of artifact ids
 * referenced by loaded RunEvent links. Pure; does not mutate the input.
 *
 * loadedLinkedEventsAffected = loaded linked ids that are NOT one of the
 * kept-latest ids (= ids whose link a keep-latest cleanup would set NULL). Only
 * result.created events carry an artifactId, so this counts old result_md links.
 */
export function summarizeCleanupPlan(
  metas: readonly Readonly<{
    id: string;
    versionCount?: number;
    representedHistoricalBytes?: number;
  }>[],
  linkedArtifactIds?: ReadonlySet<string>,
): CleanupPlanSummary {
  let cleanupCandidateRows = 0;
  let affectedGroups = 0;
  let representedHistoricalBytes = 0;
  const latestIds = new Set<string>();
  for (const m of metas) {
    latestIds.add(m.id);
    const versions = m.versionCount ?? 1;
    const older = Math.max(0, versions - 1);
    cleanupCandidateRows += older;
    if (older > 0) affectedGroups += 1;
    representedHistoricalBytes += m.representedHistoricalBytes ?? 0;
  }
  let loadedLinkedEventsAffected = 0;
  if (linkedArtifactIds) {
    for (const id of linkedArtifactIds) {
      if (!latestIds.has(id)) loadedLinkedEventsAffected += 1;
    }
  }
  return {
    totalGroups: metas.length,
    cleanupCandidateRows,
    affectedGroups,
    representedHistoricalBytes,
    loadedLinkedEventsAffected,
  };
}
