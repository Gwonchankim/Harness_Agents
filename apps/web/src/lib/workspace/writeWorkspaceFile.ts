// Shared atomic workspace writer. Phase 5 report/agent-report exporters use this
// so each new writer doesn't re-implement the tmp→rename dance. Phase 4's
// finalResult.ts / exportService.ts keep their own copies untouched (per the
// Phase 5 correction: minimal change to the existing result.md flow).
//
// DB is the source of truth; these files are best-effort export/cache.

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, sep } from 'node:path';

import { safeJoin, workspaceRoot } from './paths';

/** Hard upper bound on a single workspace export file. Mirrors the Phase 4 guards. */
export const MAX_WORKSPACE_FILE_BYTES = 5 * 1024 * 1024;

export interface WorkspaceWriteResult {
  /** Workspace-relative path (forward slashes) for the Artifact row. */
  path: string;
  /** Absolute path on disk. */
  absPath: string;
  bytes: number;
  sha256: string;
  mimeType: string;
}

/**
 * Atomically write `content` to `<workspaceRoot>/<...relParts>`. Every segment is
 * funnelled through `safeJoin`, so traversal outside the workspace throws.
 */
export async function writeWorkspaceFile(
  relParts: string[],
  content: string,
  mimeType: string,
): Promise<WorkspaceWriteResult> {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WORKSPACE_FILE_BYTES) {
    throw new Error(`workspace export exceeds ${MAX_WORKSPACE_FILE_BYTES} bytes`);
  }

  const root = workspaceRoot();
  const absPath = safeJoin(root, ...relParts);
  await mkdir(dirname(absPath), { recursive: true });

  const tmp = `${absPath}.tmp-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, absPath);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      /* ignore cleanup error */
    }
    throw err;
  }

  return {
    path: relative(root, absPath).split(sep).join('/'),
    absPath,
    bytes,
    sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    mimeType,
  };
}
