// SSE endpoint. Replays history rows since `?since=<eventId>` (also reads
// `Last-Event-ID` for native EventSource reconnect), then keeps the stream
// open and pushes new events from the in-process bus. Sends a 15s heartbeat
// so proxies don't time out.

import { prisma } from '@db/client';
import { parseJson } from '@lib/db/json';

import { ensureRecovered } from '@lib/runtime/recovery';
import { subscribeRunEvents, type RunEventEnvelope } from '@lib/dag/runRegistry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 15_000;

export async function GET(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  await ensureRecovered();
  const { runId } = await context.params;
  const url = new URL(request.url);
  const since =
    url.searchParams.get('since') ?? request.headers.get('Last-Event-ID') ?? null;

  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true, status: true },
  });
  if (!run) {
    return new Response('not_found', { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const safeEnqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      const history = await prisma.runEvent.findMany({
        where: {
          runId,
          ...(since ? { id: { gt: since } } : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 2000,
      });
      const seen = new Set<string>();
      for (const row of history) {
        seen.add(row.id);
        const envelope: RunEventEnvelope = {
          id: row.id,
          runId: row.runId,
          taskId: row.taskId,
          agentId: row.agentId,
          type: row.type,
          payload: parseJson<unknown>(row.payload, {}),
          createdAt: row.createdAt.toISOString(),
        };
        safeEnqueue(formatSse(envelope));
      }

      const unsub = subscribeRunEvents(runId, (event) => {
        if (seen.has(event.id)) return;
        seen.add(event.id);
        safeEnqueue(formatSse(event));
      });

      const heartbeat = setInterval(() => safeEnqueue(`:keepalive\n\n`), HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      request.signal.addEventListener('abort', cleanup, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

function formatSse(envelope: RunEventEnvelope): string {
  const data = JSON.stringify({
    id: envelope.id,
    runId: envelope.runId,
    taskId: envelope.taskId,
    agentId: envelope.agentId,
    type: envelope.type,
    payload: envelope.payload,
    createdAt: envelope.createdAt,
  });
  return `id: ${envelope.id}\nevent: ${envelope.type}\ndata: ${data}\n\n`;
}
