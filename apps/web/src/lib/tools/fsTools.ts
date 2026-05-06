// Sandboxed filesystem tools. Every operation funnels through safeJoin so
// nothing escapes the workspace root. Writes are atomic via a temp file +
// rename, and parent directories are created only inside the workspace. A
// payload size guard prevents accidental huge writes.

import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, sep } from 'node:path';

import { z } from 'zod';

import { safeJoin, workspaceRoot } from '@lib/workspace/paths';

import { registerTool } from './registry';

export const MAX_READ_BYTES = 5 * 1024 * 1024;
export const MAX_WRITE_BYTES = 5 * 1024 * 1024;
export const MAX_LIST_ENTRIES = 1000;

const relPathSchema = z
  .string()
  .min(1, 'relPath must be non-empty')
  .refine((s) => !s.includes('\0'), 'relPath must not contain NUL');

function resolveSandboxed(relPath: string): string {
  const root = workspaceRoot();
  return safeJoin(root, ...relPath.split(/[\\/]/).filter(Boolean));
}

async function ensureDirInsideWorkspace(filePath: string): Promise<void> {
  const root = workspaceRoot();
  const dir = dirname(filePath);
  if (!(dir === root || dir.startsWith(root + sep))) {
    throw new Error('fs: parent directory escapes workspace');
  }
  await mkdir(dir, { recursive: true });
}

registerTool({
  name: 'fs.readFile',
  enabled: true,
  description: 'Read a UTF-8 text file inside the workspace.',
  argsSchema: z.object({ relPath: relPathSchema }),
  execute: async ({ relPath }) => {
    const abs = resolveSandboxed(relPath);
    const stats = await stat(abs);
    if (!stats.isFile()) throw new Error('fs.readFile: not a regular file');
    if (stats.size > MAX_READ_BYTES) {
      throw new Error(`fs.readFile: file exceeds ${MAX_READ_BYTES} bytes`);
    }
    const content = await readFile(abs, 'utf8');
    return { relPath, bytes: stats.size, content };
  },
});

registerTool({
  name: 'fs.writeFile',
  enabled: true,
  description: 'Atomically write a UTF-8 text file inside the workspace.',
  argsSchema: z.object({
    relPath: relPathSchema,
    content: z.string(),
  }),
  execute: async ({ relPath, content }) => {
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
      throw new Error(`fs.writeFile: payload exceeds ${MAX_WRITE_BYTES} bytes`);
    }
    const abs = resolveSandboxed(relPath);
    await ensureDirInsideWorkspace(abs);
    const tmp = `${abs}.tmp-${randomBytes(6).toString('hex')}`;
    try {
      await writeFile(tmp, content, { encoding: 'utf8' });
      await rename(tmp, abs);
    } catch (err) {
      try {
        await unlink(tmp);
      } catch {
        /* ignore cleanup errors */
      }
      throw err;
    }
    return { relPath, bytes: Buffer.byteLength(content, 'utf8') };
  },
});

registerTool({
  name: 'fs.listDir',
  enabled: true,
  description: 'List immediate entries of a directory inside the workspace.',
  argsSchema: z.object({ relPath: relPathSchema }),
  execute: async ({ relPath }) => {
    const abs = resolveSandboxed(relPath);
    const stats = await stat(abs);
    if (!stats.isDirectory()) throw new Error('fs.listDir: not a directory');
    const entries = await readdir(abs, { withFileTypes: true });
    if (entries.length > MAX_LIST_ENTRIES) {
      throw new Error(`fs.listDir: too many entries (>${MAX_LIST_ENTRIES})`);
    }
    return {
      relPath,
      entries: entries.map((e) => ({
        name: e.name,
        kind: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
      })),
    };
  },
});
