// TeamRevision helpers, used inside an approve transaction. Never mutates or
// deletes existing revision rows — Phase 5 always appends a new version and
// leaves the history intact.

import type { Prisma } from '@prisma/client';

export async function nextRevisionVersion(
  tx: Prisma.TransactionClient,
  teamId: string,
): Promise<number> {
  const max = await tx.teamRevision.aggregate({
    where: { teamId },
    _max: { version: true },
  });
  return (max._max.version ?? 0) + 1;
}

export interface CreateApprovedRevisionInput {
  teamId: string;
  version: number;
  agentsSnapshot: string;
  agentsMd: string;
  teamJson: string;
  proposedBy: string;
  approvedBy: string;
  sourceRunId: string | null;
  feedbackBatchId: string | null;
  reason: string | null;
}

export async function createApprovedRevision(
  tx: Prisma.TransactionClient,
  input: CreateApprovedRevisionInput,
): Promise<{ id: string; version: number }> {
  return tx.teamRevision.create({
    data: {
      teamId: input.teamId,
      version: input.version,
      agentsSnapshot: input.agentsSnapshot,
      agentsMd: input.agentsMd,
      teamJson: input.teamJson,
      proposedBy: input.proposedBy,
      approvedBy: input.approvedBy,
      sourceRunId: input.sourceRunId,
      feedbackBatchId: input.feedbackBatchId,
      reason: input.reason,
      approvedAt: new Date(),
    },
    select: { id: true, version: true },
  });
}
