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
