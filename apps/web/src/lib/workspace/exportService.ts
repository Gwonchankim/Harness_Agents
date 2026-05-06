// WorkspaceExportService — atomic file writes for team exports. The DB is the
// source of truth; this service produces best-effort cache files. Failures
// are returned to the caller (they do NOT throw out of the route handler) so
// the team-creation transaction stays committed.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, sep } from 'node:path';

import { safeJoin, workspaceRoot } from './paths';

/**
 * Hard upper bound on a single team-export file. Mirrors the per-write guard
 * already enforced by the fs tools in lib/tools/fsTools.ts so a runaway
 * AGENTS.md or team.json can't silently fill the disk.
 */
export const MAX_EXPORT_BYTES = 5 * 1024 * 1024;

export interface ExportFileResult {
  /** Workspace-relative path (forward slashes) for the Artifact row. */
  path: string;
  /** Absolute path on disk. */
  absPath: string;
  bytes: number;
  sha256: string;
  mimeType: string;
}

export interface ExportError {
  /** Workspace-relative path the caller tried to write. */
  path: string;
  message: string;
}

export interface TeamExportInput {
  projectSlug: string;
  teamId: string;
  agentsMd: string;
  teamJson: string;
}

export interface TeamExportResult {
  wrote: Array<ExportFileResult & { kind: 'team_md' | 'team_json' }>;
  errors: ExportError[];
}

/**
 * Write AGENTS.md and team.json under projects/{projectSlug}/teams/{teamId}/.
 * Each write is independent — one failure does not block the other.
 */
export async function exportTeamFiles(input: TeamExportInput): Promise<TeamExportResult> {
  const wrote: TeamExportResult['wrote'] = [];
  const errors: ExportError[] = [];

  const targets: Array<{
    relParts: string[];
    content: string;
    kind: 'team_md' | 'team_json';
    mimeType: string;
  }> = [
    {
      relParts: [input.projectSlug, 'teams', input.teamId, 'AGENTS.md'],
      content: input.agentsMd,
      kind: 'team_md',
      mimeType: 'text/markdown',
    },
    {
      relParts: [input.projectSlug, 'teams', input.teamId, 'team.json'],
      content: input.teamJson,
      kind: 'team_json',
      mimeType: 'application/json',
    },
  ];

  for (const t of targets) {
    try {
      const result = await writeAtomic(t.relParts, t.content, t.mimeType);
      wrote.push({ ...result, kind: t.kind });
    } catch (err) {
      errors.push({
        path: t.relParts.join('/'),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { wrote, errors };
}

async function writeAtomic(
  relParts: string[],
  content: string,
  mimeType: string,
): Promise<ExportFileResult> {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_EXPORT_BYTES) {
    throw new Error(`export exceeds ${MAX_EXPORT_BYTES} bytes`);
  }

  const root = workspaceRoot();
  const absPath = safeJoin(root, ...relParts);
  await mkdir(dirname(absPath), { recursive: true });

  const tmp = `${absPath}.tmp-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(tmp, content, { encoding: 'utf8' });
    await rename(tmp, absPath);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      /* ignore cleanup error */
    }
    throw err;
  }

  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  const rel = relative(root, absPath).split(sep).join('/');

  return {
    path: rel,
    absPath,
    bytes,
    sha256,
    mimeType,
  };
}
