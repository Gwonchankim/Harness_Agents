// POST /api/runs/[runId]/feedback — persist a feedback batch for a succeeded run
// and recompute the team score. Append-only: each call creates a new batch.

import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { recomputeTeamScore } from '@lib/feedback/aggregate';
import { createFeedbackBatch, FeedbackValidationError } from '@lib/feedback/persist';
import { ensureRecovered } from '@lib/runtime/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AgentFeedbackBody {
  agentId?: unknown;
  rating?: unknown;
  comment?: unknown;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  await ensureRecovered();
  const { runId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: { id: true, status: true, teamId: true },
  });
  if (!run) return NextResponse.json({ error: 'run_not_found' }, { status: 404 });
  if (!run.teamId) return NextResponse.json({ error: 'run_has_no_team' }, { status: 409 });
  if (run.status !== 'succeeded') {
    return NextResponse.json({ error: 'run_not_succeeded', status: run.status }, { status: 409 });
  }

  const { resultRating, resultComment, agentFeedback } = body as {
    resultRating?: unknown;
    resultComment?: unknown;
    agentFeedback?: unknown;
  };
  const agents = Array.isArray(agentFeedback) ? (agentFeedback as AgentFeedbackBody[]) : [];

  try {
    const { batchId } = await createFeedbackBatch({
      runId: run.id,
      teamId: run.teamId,
      resultRating: typeof resultRating === 'number' ? resultRating : null,
      resultComment: typeof resultComment === 'string' ? resultComment : null,
      agentFeedback: agents.map((a) => ({
        agentId: typeof a?.agentId === 'string' ? a.agentId : '',
        rating: typeof a?.rating === 'number' ? a.rating : -1,
        comment: typeof a?.comment === 'string' ? a.comment : null,
      })),
    });
    const teamScore = await recomputeTeamScore(run.teamId);
    return NextResponse.json({ ok: true, batchId, teamScore });
  } catch (err) {
    if (err instanceof FeedbackValidationError) {
      return NextResponse.json({ error: err.reason }, { status: 400 });
    }
    throw err;
  }
}
