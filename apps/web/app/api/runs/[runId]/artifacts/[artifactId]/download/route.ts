import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { attachmentContentDisposition } from '@lib/results/contentDisposition';
import { ensureRecovered } from '@lib/runtime/recovery';
import { safeJoin, workspaceRoot } from '@lib/workspace/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

// Phase 16: stream the original bytes of a SINGLE exported artifact as an
// attachment download. Separate from the preview route (which returns capped
// JSON text): this returns the raw file with the stored mimeType so non-text
// artifacts (team.json) download correctly. The file is streamed from disk
// (createReadStream) so 5MB+ exports never load fully into memory. Ownership is
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

  let absPath: string;
  let size: number;
  try {
    absPath = safeJoin(workspaceRoot(), artifact.path);
    const st = await stat(absPath);
    if (!st.isFile()) throw new Error('not a file');
    size = st.size;
  } catch {
    // DB row exists but the file is gone/unreadable (or the path is unsafe).
    return NextResponse.json({ error: 'artifact_file_missing' }, { status: 404 });
  }

  const contentType =
    artifact.mimeType && artifact.mimeType.trim() ? artifact.mimeType : 'application/octet-stream';
  const body = Readable.toWeb(createReadStream(absPath)) as unknown as ReadableStream<Uint8Array>;

  return new Response(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(size),
      'Content-Disposition': attachmentContentDisposition(basename(artifact.path)),
      // Defense-in-depth: never let the browser sniff a different type than the
      // stored mimeType (attachment disposition already prevents inline render).
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}
