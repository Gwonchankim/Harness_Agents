import { resolve, isAbsolute, normalize, relative, sep } from 'node:path';

// Workspace files (run.json, AGENTS.md, agent-reports/*) live OUTSIDE the DB.
// The DB stays the source of truth; these paths are export targets.
//
// Default root: <repo>/projects (gitignored). Override with HARNESS_WORKSPACE_ROOT.

export function workspaceRoot(): string {
  const envRoot = process.env.HARNESS_WORKSPACE_ROOT?.trim();
  if (envRoot) return resolve(envRoot);
  // apps/web/src/lib/workspace/paths.ts → repo root is 5 levels up.
  return resolve(__dirname, '../../../../../projects');
}

export function projectDir(projectSlug: string): string {
  return safeJoin(workspaceRoot(), projectSlug);
}

export function runDir(projectSlug: string, runId: string): string {
  return safeJoin(projectDir(projectSlug), 'runs', runId);
}

export function teamDir(projectSlug: string, teamId: string): string {
  return safeJoin(projectDir(projectSlug), 'teams', teamId);
}

export function agentReportsDir(projectSlug: string, runId: string): string {
  return safeJoin(runDir(projectSlug, runId), 'agent-reports');
}

/**
 * Join `base` with one or more user-supplied path segments, then verify the
 * resolved path is contained within `base`. Throws if any segment attempts
 * to escape — `..`, absolute paths, Windows drive prefixes, NUL bytes, or any
 * normalization that lands outside the base directory.
 *
 * Phase 1 fs tools must funnel every read/write through this helper before
 * touching disk.
 */
export function safeJoin(base: string, ...segments: string[]): string {
  if (typeof base !== 'string' || base.length === 0) {
    throw new SafePathError('safeJoin: base must be a non-empty string');
  }

  for (const segment of segments) {
    assertSegmentSafe(segment);
  }

  const resolvedBase = resolve(base);
  const candidate = resolve(resolvedBase, ...segments);

  if (!isWithin(resolvedBase, candidate)) {
    throw new SafePathError(
      `safeJoin: resolved path escapes the workspace root. base=${resolvedBase} candidate=${candidate}`,
    );
  }

  return candidate;
}

/**
 * Returns true if `child` is the same as `parent` or is contained inside it.
 * Uses `path.relative` so cross-drive paths on Windows (which produce an
 * absolute relative result) are correctly rejected.
 */
export function isWithin(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  if (rel === '') return true;
  if (isAbsolute(rel)) return false; // different drive on Windows
  if (rel === '..' || rel.startsWith(`..${sep}`) || rel.startsWith('../')) return false;
  return true;
}

export class SafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafePathError';
  }
}

function assertSegmentSafe(segment: unknown): asserts segment is string {
  if (typeof segment !== 'string') {
    throw new SafePathError(
      `safeJoin: segment must be a string (got ${segment === null ? 'null' : typeof segment})`,
    );
  }
  if (segment.length === 0) {
    throw new SafePathError('safeJoin: empty segment is not allowed');
  }
  if (segment.includes('\0')) {
    throw new SafePathError('safeJoin: NUL byte in segment is not allowed');
  }
  if (isAbsolute(segment)) {
    throw new SafePathError(`safeJoin: absolute segment is not allowed (${segment})`);
  }
  // Windows drive-letter prefix without a separator — e.g. "C:notes" — is a
  // drive-relative path. node:path::isAbsolute does not flag it, so check here.
  if (/^[A-Za-z]:/.test(segment)) {
    throw new SafePathError(`safeJoin: drive-letter segment is not allowed (${segment})`);
  }
  // UNC prefix.
  if (segment.startsWith('\\\\') || segment.startsWith('//')) {
    throw new SafePathError(`safeJoin: UNC segment is not allowed (${segment})`);
  }
  const parts = normalize(segment).split(/[\\/]/);
  for (const part of parts) {
    if (part === '..') {
      throw new SafePathError(`safeJoin: '..' traversal is not allowed (${segment})`);
    }
  }
}
