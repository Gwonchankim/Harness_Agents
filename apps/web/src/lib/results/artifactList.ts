// Pure artifact display helper (Phase 15). Artifact rows are append-only (a new
// row per (re-)export), so the UI/query layer collapses them to the latest row
// per (kind, path) for display. No DB cleanup/upsert — selection happens here.

export interface ArtifactRow {
  id: string;
  kind: string;
  path: string;
  bytes: number;
  sha256: string | null;
  createdAt: string; // ISO
  taskId: string | null;
}

// Display order: deliverable first, then run report, then agent reports, then rest.
function kindOrder(kind: string): number {
  if (kind === 'result_md') return 0;
  if (kind === 'report_md') return 1;
  if (kind === 'agent_report_md') return 2;
  return 3;
}

function isNewer(a: ArtifactRow, b: ArtifactRow): boolean {
  // ISO createdAt is lexicographically sortable; tie-break by id (cuid is
  // chronological enough that a later id wins) so selection is deterministic.
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

/** Latest artifact per (kind, path), in a stable display order. */
export function selectLatestArtifacts(rows: readonly ArtifactRow[]): ArtifactRow[] {
  const latest = new Map<string, ArtifactRow>();
  for (const r of rows) {
    const key = `${r.kind} ${r.path}`;
    const cur = latest.get(key);
    if (!cur || isNewer(r, cur)) latest.set(key, r);
  }
  return [...latest.values()].sort((a, b) => {
    const ko = kindOrder(a.kind) - kindOrder(b.kind);
    if (ko !== 0) return ko;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}

export interface ArtifactHistoryGroup {
  kind: string;
  path: string;
  latest: ArtifactRow;
  versions: ArtifactRow[]; // all rows for (kind, path), newest first
}

/**
 * Phase 16: group append-only rows by (kind, path) into a creation history.
 * Within each group `versions` is sorted newest-first (createdAt desc, id
 * tiebreak — same ordering as selectLatestArtifacts), and `latest` is
 * versions[0]. Groups are returned in the same display order as
 * selectLatestArtifacts. Pure / prisma-free for unit testing.
 *
 * Note: only the latest version's file survives on disk (writers overwrite the
 * same path), so past versions are audit metadata only — their content is not
 * recoverable.
 */
export function groupArtifactHistory(rows: readonly ArtifactRow[]): ArtifactHistoryGroup[] {
  const groups = new Map<string, ArtifactRow[]>();
  for (const r of rows) {
    const key = `${r.kind} ${r.path}`;
    const arr = groups.get(key);
    if (arr) arr.push(r);
    else groups.set(key, [r]);
  }
  const out: ArtifactHistoryGroup[] = [];
  for (const versions of groups.values()) {
    versions.sort((a, b) => (isNewer(a, b) ? -1 : isNewer(b, a) ? 1 : 0));
    const latest = versions[0];
    if (!latest) continue;
    out.push({ kind: latest.kind, path: latest.path, latest, versions });
  }
  return out.sort((a, b) => {
    const ko = kindOrder(a.kind) - kindOrder(b.kind);
    if (ko !== 0) return ko;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
}
