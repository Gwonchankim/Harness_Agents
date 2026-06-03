import { createReadStream } from 'node:fs';

import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { decodePreview } from '@lib/results/artifactPreview';
import { ensureRecovered } from '@lib/runtime/recovery';
import { safeJoin, workspaceRoot, SafePathError } from '@lib/workspace/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Cap how much of a large export the preview returns. The full file stays on
// disk (source of truth); this only bounds the on-demand UI payload.
const MAX_PREVIEW_CHARS = 200_000;

// Phase 17: hard memory bound for the on-demand preview read. Equal to the char
// cap so mostly-ASCII exports preview exactly as before (1 byte ≈ 1 char); files
// with multibyte text cap out at fewer chars, which is acceptable — the full file
// is always on disk and reachable via download. Replaces the previous whole-file
// readFile (which had no read-side size limit).
const PREVIEW_BYTE_BUDGET = MAX_PREVIEW_CHARS;

// Read at most PREVIEW_BYTE_BUDGET + 1 bytes from the start of the file. The
// extra byte is the truncation probe: createReadStream's `end` is INCLUSIVE, so
// end=budget yields budget+1 bytes; if we actually receive more than `budget`
// bytes the file continues past the budget (hadMore). Only the first `budget`
// bytes are handed to the decoder.
function readBounded(
  absPath: string,
  budget: number,
): Promise<{ buf: Buffer; hadMore: boolean }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(absPath, { start: 0, end: budget });
    stream.on('data', (chunk) => {
      chunks.push(chunk as Buffer);
    });
    stream.on('end', () => {
      const all = Buffer.concat(chunks);
      resolve({ buf: all.subarray(0, budget), hadMore: all.length > budget });
    });
    stream.on('error', reject);
  });
}

// Phase 15/17: lazy text preview of a SINGLE exported artifact (result.md /
// report.md / agent-reports/*). The state/page endpoints carry metadata only;
// file content is read here on demand, BOUNDED to a byte budget (never the whole
// file). The stored path is validated through safeJoin (must resolve inside the
// workspace root), and a row whose file is missing on disk degrades to
// { missing: true } rather than erroring.
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
    select: { kind: true, path: true, bytes: true, createdAt: true },
  });
  if (!artifact) {
    return NextResponse.json({ error: 'artifact_not_found' }, { status: 404 });
  }

  const meta = {
    kind: artifact.kind,
    path: artifact.path,
    bytes: artifact.bytes,
    createdAt: artifact.createdAt.toISOString(),
  };

  let buf: Buffer;
  let hadMore: boolean;
  try {
    const absPath = safeJoin(workspaceRoot(), artifact.path);
    ({ buf, hadMore } = await readBounded(absPath, PREVIEW_BYTE_BUDGET));
  } catch (err) {
    // DB row exists but the file is gone/unreadable (or the path is unsafe) —
    // degrade gracefully instead of 500. Response stays opaque; the log
    // discriminates ENOENT (expected) from EACCES/path-escape (unexpected)
    // without leaking the path or file content.
    const code =
      err instanceof SafePathError ? 'ESAFEPATH' : (err as NodeJS.ErrnoException)?.code;
    const line = `[artifacts:preview] file read failed runId=${runId} artifactId=${artifactId} code=${code ?? 'unknown'}`;
    if (code === 'ENOENT') console.warn(line);
    else console.error(line);
    return NextResponse.json({ artifact: meta, missing: true });
  }

  const { preview, truncated } = decodePreview(buf, hadMore, MAX_PREVIEW_CHARS);
  if (truncated) {
    // Authoritative size signal when truncated is totalBytes (from the DB row);
    // the exact full char count is unknowable from a partial read, so totalChars
    // is omitted here. totalChars is kept (additive) only for the non-truncated
    // path below, preserving the existing client contract.
    return NextResponse.json({
      artifact: meta,
      content: preview,
      truncated: true,
      totalBytes: artifact.bytes,
    });
  }
  return NextResponse.json({
    artifact: meta,
    content: preview,
    truncated: false,
    totalChars: preview.length,
  });
}
