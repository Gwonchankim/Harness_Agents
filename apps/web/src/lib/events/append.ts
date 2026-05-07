// appendEvent — write a RunEvent row + emit on the in-process bus. The payload
// passes through the Phase 4 event redactor (secrets + size guard) before
// hitting the DB. Returned envelope is what SSE/polling forward to clients.

import { prisma } from '@db/client';

import { stringifyJson } from '@lib/db/json';
import { publishRunEvent, type RunEventEnvelope } from '@lib/dag/runRegistry';

import { redactEventPayload } from './redactor';

export interface AppendEventArgs {
  runId: string;
  taskId?: string | null;
  agentId?: string | null;
  type: string;
  payload: unknown;
  artifactId?: string | null;
}

export async function appendEvent(args: AppendEventArgs): Promise<RunEventEnvelope> {
  const safePayload = redactEventPayload(args.payload ?? {});
  const row = await prisma.runEvent.create({
    data: {
      runId: args.runId,
      taskId: args.taskId ?? null,
      agentId: args.agentId ?? null,
      type: args.type,
      payload: stringifyJson(safePayload),
      artifactId: args.artifactId ?? null,
    },
    select: {
      id: true,
      runId: true,
      taskId: true,
      agentId: true,
      type: true,
      createdAt: true,
    },
  });

  const envelope: RunEventEnvelope = {
    id: row.id,
    runId: row.runId,
    taskId: row.taskId,
    agentId: row.agentId,
    type: row.type,
    payload: safePayload,
    createdAt: row.createdAt.toISOString(),
  };

  publishRunEvent(args.runId, envelope);
  return envelope;
}
