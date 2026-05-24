import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import {
  judgeAnswer,
  PoAuthError,
  PoSchemaError,
  ProviderUnavailableError,
} from '@lib/agents/po';
import { stringifyJson } from '@lib/db/json';
import { ModelDisabledError, UnknownProviderError } from '@lib/models/catalog';
import { buildHistoryLines, loadSession, shouldAutoComplete } from '@lib/qa/sessionState';
import {
  coerceSkipToAutoJudge,
  InvalidAnswerInputError,
  isAnswerable,
  valueForChoice,
} from '@lib/qa/skipPolicy';
import { GenerateAbortedError, GenerateTimeoutError } from '@lib/qa/timeout';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { questionId, choiceIndex, choiceIndices, customText, skip } = body as {
    questionId?: unknown;
    choiceIndex?: unknown;
    choiceIndices?: unknown;
    customText?: unknown;
    skip?: unknown;
  };
  if (typeof questionId !== 'string' || questionId.length === 0) {
    return NextResponse.json({ error: 'questionId_required' }, { status: 400 });
  }

  let normalized;
  try {
    normalized = coerceSkipToAutoJudge({
      choiceIndex: typeof choiceIndex === 'number' ? choiceIndex : undefined,
      choiceIndices: Array.isArray(choiceIndices)
        ? choiceIndices.map((idx) => (typeof idx === 'number' ? idx : Number.NaN))
        : undefined,
      customText: typeof customText === 'string' ? customText : undefined,
      skip: skip === true,
    });
  } catch (err) {
    if (err instanceof InvalidAnswerInputError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const view = await loadSession(sessionId);
  if (!view) return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
  if (view.isComplete) {
    return NextResponse.json({ error: 'session_completed' }, { status: 409 });
  }
  const question = view.questions.find((q) => q.id === questionId);
  if (!question) {
    return NextResponse.json({ error: 'question_not_found' }, { status: 404 });
  }
  if (!isAnswerable(question.status)) {
    return NextResponse.json(
      { error: 'question_not_answerable', status: question.status },
      { status: 409 },
    );
  }

  const run = await prisma.run.findUnique({
    where: { id: view.runId },
    select: { prompt: true, poModelId: true },
  });
  if (!run || !run.poModelId) {
    return NextResponse.json({ error: 'run_missing_model' }, { status: 500 });
  }

  let value: unknown;
  let isAutoJudged = false;
  if (normalized.choiceIndex === 5) {
    try {
      const judged = await judgeAnswer(
        {
          modelId: run.poModelId,
          userPrompt: run.prompt,
          historyLines: buildHistoryLines(view),
          signal: request.signal,
        },
        { prompt: question.prompt, options: question.options },
      );
      const chosenValue = (
        question.options.filter((o) => o.kind === 'choice')[judged.choiceIndex - 1] ?? {}
      ).value;
      value = { chosenValue, rationale: judged.rationale };
      isAutoJudged = true;
    } catch (err) {
      return mapPoError(err);
    }
  } else {
    try {
      value = valueForChoice(question.options, normalized);
    } catch (err) {
      if (err instanceof InvalidAnswerInputError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }
  }

  // Edit when this question already has a current answer AND any downstream
  // question exists (answered or not). Marking downstream questions stale on
  // every re-answer keeps the timeline consistent — a generated-but-unanswered
  // Q6 must not survive untouched if the user re-answers Q3.
  const isEdit =
    question.answer != null &&
    view.questions.some((q) => q.order > question.order);

  await prisma.$transaction(async (tx) => {
    await tx.qaAnswer.upsert({
      where: { sessionId_questionId: { sessionId, questionId } },
      update: {
        choiceIndex: normalized.choiceIndex,
        customText: normalized.choiceIndex === 6 ? (normalized.customText ?? null) : null,
        value: stringifyJson(value),
        isAutoJudged,
      },
      create: {
        sessionId,
        questionId,
        choiceIndex: normalized.choiceIndex,
        customText: normalized.choiceIndex === 6 ? (normalized.customText ?? null) : null,
        value: stringifyJson(value),
        isAutoJudged,
      },
    });
    if (isEdit) {
      await tx.qaQuestion.updateMany({
        where: {
          sessionId,
          order: { gt: question.order },
        },
        data: { status: 'stale', staleAt: new Date() },
      });
    }
  });

  const after = await loadSession(sessionId);
  if (!after) {
    return NextResponse.json({ error: 'session_disappeared' }, { status: 500 });
  }
  const latest = after.questions.find((q) => q.id === questionId);
  if (latest && shouldAutoComplete(after, latest)) {
    await prisma.qaSession.update({
      where: { id: sessionId },
      data: { status: 'completed' },
    });
  }

  const final = await loadSession(sessionId);
  return NextResponse.json({
    ok: true,
    isAutoJudged,
    session: final,
  });
}

function mapPoError(err: unknown) {
  if (err instanceof GenerateAbortedError) {
    return NextResponse.json({ error: 'aborted' }, { status: 499 });
  }
  if (err instanceof GenerateTimeoutError) {
    return NextResponse.json(
      {
        error: 'timeout',
        timeoutMs: err.timeoutMs,
        provider: err.provider,
        modelId: err.modelId,
      },
      { status: 504 },
    );
  }
  if (err instanceof ProviderUnavailableError) {
    return NextResponse.json(
      { error: 'provider_unavailable', provider: err.provider, reason: err.reason },
      { status: 503 },
    );
  }
  if (err instanceof PoAuthError) {
    return NextResponse.json(
      { error: 'provider_auth_failed', provider: err.provider, status: err.status },
      { status: 401 },
    );
  }
  if (err instanceof PoSchemaError) {
    return NextResponse.json({ error: 'po_schema_error' }, { status: 502 });
  }
  if (err instanceof UnknownProviderError) {
    return NextResponse.json(
      { error: 'unknown_provider', provider: err.provider },
      { status: 500 },
    );
  }
  if (err instanceof ModelDisabledError) {
    return NextResponse.json({ error: 'model_disabled' }, { status: 409 });
  }
  return NextResponse.json(
    { error: 'po_failed', message: err instanceof Error ? err.message : String(err) },
    { status: 500 },
  );
}
