import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { prisma } from '@db/client';

import { generateNextQuestion } from '@lib/agents/po';
import { poErrorResponse } from '@lib/agents/poErrorResponse';
import { stringifyJson } from '@lib/db/json';
import {
  buildHistoryLines,
  findLowestStaleOrder,
  loadSession,
  QA_LIMITS,
} from '@lib/qa/sessionState';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  let body: { regenerateOrder?: number } = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === 'object') body = parsed as { regenerateOrder?: number };
  } catch {
    /* empty body is fine */
  }

  const view = await loadSession(sessionId);
  if (!view) return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
  if (view.isComplete) {
    return NextResponse.json({ error: 'session_completed' }, { status: 409 });
  }

  // Stale gate: if any question is stale and the caller did not specifically
  // ask to regenerate a stale order, block all next-generation paths so we
  // never create (e.g.) Q6 while Q3..Q5 are stale.
  if (body.regenerateOrder == null) {
    const lowestStaleOrder = findLowestStaleOrder(view);
    if (lowestStaleOrder != null) {
      return NextResponse.json(
        { error: 'stale_questions_pending', lowestStaleOrder },
        { status: 409 },
      );
    }
  }

  // Idempotency: if the client already has an active unanswered question
  // (and we're not specifically regenerating a stale one), return it.
  if (body.regenerateOrder == null && view.currentQuestion) {
    return NextResponse.json({
      mode: 'existing',
      question: view.currentQuestion,
      session: view,
    });
  }

  const run = await prisma.run.findUnique({
    where: { id: view.runId },
    select: { prompt: true, poModelId: true },
  });
  if (!run || !run.poModelId) {
    return NextResponse.json({ error: 'run_missing_model' }, { status: 500 });
  }

  const historyLines = buildHistoryLines(view);

  let regeneratingOrder: number | undefined;
  let targetQuestionId: string | null = null;
  let questionNumber: number;

  if (body.regenerateOrder != null) {
    const stale = view.questions.find(
      (q) => q.order === body.regenerateOrder && q.status === 'stale',
    );
    if (!stale) {
      return NextResponse.json({ error: 'stale_question_not_found' }, { status: 400 });
    }
    regeneratingOrder = stale.order;
    targetQuestionId = stale.id;
    questionNumber = stale.order;
  } else {
    const nextOrder = view.questions.length + 1;
    if (nextOrder > QA_LIMITS.MAX_QUESTIONS) {
      return NextResponse.json({ error: 'max_questions_reached' }, { status: 409 });
    }
    questionNumber = nextOrder;
  }

  let result;
  try {
    result = await generateNextQuestion(
      {
        modelId: run.poModelId,
        userPrompt: run.prompt,
        historyLines,
        signal: request.signal,
      },
      questionNumber,
      {
        regeneratingOrder,
        minQuestions: QA_LIMITS.MIN_QUESTIONS,
        maxQuestions: QA_LIMITS.MAX_QUESTIONS,
      },
    );
  } catch (err) {
    return poErrorResponse(err, 'po_failed');
  }

  try {
    if (targetQuestionId) {
      await prisma.qaQuestion.update({
        where: { id: targetQuestionId },
        data: {
          prompt: result.prompt,
          kind: result.kind,
          options: stringifyJson(result.options),
          isFinal: result.isFinal,
          status: 'active',
          staleAt: null,
          regeneratedAt: new Date(),
        },
      });
    } else {
      await prisma.qaQuestion.create({
        data: {
          sessionId,
          order: questionNumber,
          prompt: result.prompt,
          kind: result.kind,
          options: stringifyJson(result.options),
          isFinal: result.isFinal,
          status: 'active',
        },
      });
    }
  } catch (err) {
    if (
      !targetQuestionId &&
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      const existing = await loadSession(sessionId);
      return NextResponse.json({
        mode: 'existing',
        question: existing?.currentQuestion ?? null,
        session: existing,
      });
    }
    throw err;
  }

  const after = await loadSession(sessionId);
  if (!after) {
    return NextResponse.json({ error: 'session_disappeared' }, { status: 500 });
  }
  return NextResponse.json({
    mode: targetQuestionId ? 'regenerated' : 'generated',
    question:
      after.questions.find((q) =>
        targetQuestionId ? q.id === targetQuestionId : q.order === questionNumber,
      ) ?? null,
    session: after,
  });
}
