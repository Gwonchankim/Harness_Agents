import { open, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { attachmentContentDisposition } from '@lib/results/contentDisposition';
import { ensureRecovered } from '@lib/runtime/recovery';
import { safeJoin, workspaceRoot, SafePathError } from '@lib/workspace/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

// Phase 16/17: stream the original bytes of a SINGLE exported artifact as an
// attachment download. Separate from the preview route (which returns capped
// JSON text): this returns the raw file with the stored mimeType so non-text
// artifacts (team.json) download correctly.
//
// Phase 17 hardens this to a SINGLE file descriptor: open → fstat →
// createReadStream({ fd }) so Content-Length (from fstat) and the streamed bytes
// come from the same inode (eliminates the stat↔stream TOCTOU). The file is
// streamed from disk so 5MB+ exports never load fully into memory. Ownership is
// enforced by (id, runId); a row whose file is missing/unsafe → 404, never 500.
export async function GET(
  _request: Request,
  context: { params: Promise<{ runId: string; artifactId: string }> },
) {
  await ensureRecovered();
  const { runId, artifactId } = await context.params;
  if (!runId || !artifactId) {
    return NextResponse.json({ error: 'params_required' }, { status: 400 });
  }

  // Ownership: the artifact must belong to this run.
  const artifact = await prisma.artifact.findFirst({
    where: { id: artifactId, runId },
    select: { path: true, mimeType: true },
  });
  if (!artifact) {
    return NextResponse.json({ error: 'artifact_not_found' }, { status: 404 });
  }

  let fh: FileHandle | null = null;
  try {
    const absPath = safeJoin(workspaceRoot(), artifact.path);
    fh = await open(absPath, 'r');
    const st = await fh.stat();
    if (!st.isFile()) throw new Error('not a file');

    const contentType =
      artifact.mimeType && artifact.mimeType.trim() ? artifact.mimeType : 'application/octet-stream';

    // Stream from the SAME fd. createReadStream({ autoClose: true }) now OWNS the
    // descriptor and closes it when the stream ends/errors. Hand off ownership by
    // nulling `fh` so the catch never double-closes it. (§9 checklist: the success
    // path must NOT close fh; only the pre-stream failure path below closes it.)
    const nodeStream = fh.createReadStream({ autoClose: true });
    fh = null;
    nodeStream.on('error', (err) => {
      // The response body has already started; we cannot change the response.
      // Log only, with a stable identifier + small context (no path/content).
      const code = (err as NodeJS.ErrnoException)?.code ?? 'unknown';
      console.error(
        `[artifacts:download] stream error runId=${runId} artifactId=${artifactId} code=${code}`,
      );
    });
    const body = Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(st.size),
        'Content-Disposition': attachmentContentDisposition(basename(artifact.path)),
        // Defense-in-depth: never let the browser sniff a different type than the
        // stored mimeType (attachment disposition already prevents inline render).
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    // Reached only on failure BEFORE stream hand-off (safeJoin/open/fstat/isFile)
    // — fh is still owned here, so close it to avoid an fd leak. Response stays
    // opaque (404); the log discriminates ENOENT (expected) from EACCES/
    // path-escape (unexpected) without leaking the path or file content.
    if (fh) {
      try {
        await fh.close();
      } catch {
        /* ignore close failure */
      }
    }
    const code =
      err instanceof SafePathError ? 'ESAFEPATH' : (err as NodeJS.ErrnoException)?.code;
    const line = `[artifacts:download] file open failed runId=${runId} artifactId=${artifactId} code=${code ?? 'unknown'}`;
    if (code === 'ENOENT') console.warn(line);
    else console.error(line);
    return NextResponse.json({ error: 'artifact_file_missing' }, { status: 404 });
  }
}
