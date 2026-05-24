// Feedback persistence. Append-only: every submission creates a fresh
// FeedbackBatch (never updates an existing one). One transaction writes the
// batch + uniform Feedback log rows + structured AgentRating rows.

import { prisma } from '@db/client';

export const MAX_FEEDBACK_COMMENT_LEN = 4000;

export class FeedbackValidationError extends Error {
  constructor(public readonly reason: string) {
    super(`feedback_validation_error: ${reason}`);
    this.name = 'FeedbackValidationError';
  }
}

export interface AgentFeedbackInput {
  agentId: string;
  rating: number; // 1..5
  comment?: string | null;
}

export interface CreateFeedbackBatchInput {
  runId: string;
  teamId: string;
  resultRating?: number | null; // 1..5
  resultComment?: string | null;
  agentFeedback: AgentFeedbackInput[];
}

export async function createFeedbackBatch(
  input: CreateFeedbackBatchInput,
): Promise<{ batchId: string }> {
  const resultRating = normalizeRating(input.resultRating, 'result_rating', false);
  const resultComment = normalizeComment(input.resultComment, 'result_comment');

  const seen = new Set<string>();
  for (const af of input.agentFeedback) {
    if (typeof af.agentId !== 'string' || af.agentId.length === 0) {
      throw new FeedbackValidationError('agent_id_required');
    }
    if (seen.has(af.agentId)) throw new FeedbackValidationError('duplicate_agent_feedback');
    seen.add(af.agentId);
  }

  const normalizedAgents = input.agentFeedback.map((af) => ({
    agentId: af.agentId,
    rating: normalizeRating(af.rating, 'agent_rating', true)!,
    comment: normalizeComment(af.comment, 'agent_comment'),
  }));

  if (resultRating == null && resultComment == null && normalizedAgents.length === 0) {
    throw new FeedbackValidationError('empty_feedback');
  }

  const batch = await prisma.$transaction(async (tx) => {
    if (normalizedAgents.length > 0) {
      const teamAgents = await tx.agent.findMany({
        where: { teamId: input.teamId },
        select: { id: true },
      });
      const teamAgentIds = new Set(teamAgents.map((a) => a.id));
      for (const af of normalizedAgents) {
        if (!teamAgentIds.has(af.agentId)) {
          throw new FeedbackValidationError('agent_not_in_team');
        }
      }
    }

    const created = await tx.feedbackBatch.create({
      data: { runId: input.runId, resultRating, resultComment },
      select: { id: true },
    });

    if (resultRating != null || resultComment != null) {
      await tx.feedback.create({
        data: {
          batchId: created.id,
          agentId: null,
          kind: 'result',
          rating: resultRating,
          comment: resultComment,
        },
      });
    }

    for (const af of normalizedAgents) {
      await tx.feedback.create({
        data: {
          batchId: created.id,
          agentId: af.agentId,
          kind: 'agent',
          rating: af.rating,
          comment: af.comment,
        },
      });
      await tx.agentRating.create({
        data: {
          batchId: created.id,
          agentId: af.agentId,
          rating: af.rating,
          comment: af.comment,
        },
      });
    }

    return created;
  });

  return { batchId: batch.id };
}

function normalizeRating(value: unknown, field: string, required: boolean): number | null {
  if (value == null) {
    if (required) throw new FeedbackValidationError(`${field}_required`);
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new FeedbackValidationError(`${field}_out_of_range`);
  }
  return value;
}

function normalizeComment(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') throw new FeedbackValidationError(`${field}_invalid`);
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_FEEDBACK_COMMENT_LEN) {
    throw new FeedbackValidationError(`${field}_too_long`);
  }
  return trimmed;
}
