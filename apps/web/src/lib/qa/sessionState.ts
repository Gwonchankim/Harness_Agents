// Typed session-state loader. Joins QaSession + ordered questions + answers,
// and returns a fully decoded view that the routes / pages / client UI can
// consume without touching raw JSON-string columns.

import { prisma } from '@db/client';

import { parseJson } from '@lib/db/json';
import type { PoQuestionOption } from './skipPolicy';

export interface QaQuestionView {
  id: string;
  order: number;
  prompt: string;
  kind: string;
  options: PoQuestionOption[];
  status: 'active' | 'stale' | 'superseded' | string;
  staleAt: Date | null;
  regeneratedAt: Date | null;
  isFinal: boolean;
  createdAt: Date;
  /** The current answer attached to this question, or null if unanswered or
   *  the existing answer was orphaned by a regeneration. */
  answer: QaAnswerView | null;
}

export interface QaAnswerView {
  id: string;
  choiceIndex: number | null;
  customText: string | null;
  value: unknown;
  isAutoJudged: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionView {
  sessionId: string;
  runId: string;
  status: 'active' | 'completed' | string;
  questions: QaQuestionView[];
  /** First active question without a current answer, or null. */
  currentQuestion: QaQuestionView | null;
  /** Stale questions in ascending order. */
  staleQuestions: QaQuestionView[];
  /** Highest order with a current answer; 0 if none. */
  maxAnsweredOrder: number;
  /** True when QaSession.status === 'completed'. */
  isComplete: boolean;
}

const MIN_QUESTIONS = 5;
const MAX_QUESTIONS = 6;

export const QA_LIMITS = { MIN_QUESTIONS, MAX_QUESTIONS } as const;

/** Load a session with its questions and answers as typed views. */
export async function loadSession(sessionId: string): Promise<SessionView | null> {
  const session = await prisma.qaSession.findUnique({
    where: { id: sessionId },
    include: {
      questions: {
        orderBy: { order: 'asc' },
        include: {
          answers: { orderBy: { updatedAt: 'desc' }, take: 1 },
        },
      },
    },
  });
  if (!session) return null;

  const questions: QaQuestionView[] = session.questions.map((q) => {
    const options = parseJson<PoQuestionOption[]>(q.options, []);
    const rawAnswer = q.answers[0] ?? null;
    const answer: QaAnswerView | null = rawAnswer
      ? {
          id: rawAnswer.id,
          choiceIndex: rawAnswer.choiceIndex,
          customText: rawAnswer.customText,
          value: parseJson<unknown>(rawAnswer.value, null),
          isAutoJudged: rawAnswer.isAutoJudged,
          createdAt: rawAnswer.createdAt,
          updatedAt: rawAnswer.updatedAt,
        }
      : null;
    return {
      id: q.id,
      order: q.order,
      prompt: q.prompt,
      kind: q.kind,
      options,
      status: q.status,
      staleAt: q.staleAt,
      regeneratedAt: q.regeneratedAt,
      isFinal: q.isFinal,
      createdAt: q.createdAt,
      answer: isCurrentAnswer(q, answer) ? answer : null,
    };
  });

  const currentQuestion = deriveCurrentQuestion(questions);
  const staleQuestions = findStaleQuestions(questions);
  const answeredOrders = questions.filter((q) => q.answer != null).map((q) => q.order);
  const maxAnsweredOrder = answeredOrders.length === 0 ? 0 : Math.max(...answeredOrders);

  return {
    sessionId: session.id,
    runId: session.runId,
    status: session.status,
    questions,
    currentQuestion,
    staleQuestions,
    maxAnsweredOrder,
    isComplete: session.status === 'completed',
  };
}

/**
 * Decide whether the session should auto-complete after the latest answer.
 * MVP rule (per Phase 2 adjustments): complete when (order >= 5 && isFinal)
 * OR order === 6, AND there are no stale questions outstanding.
 */
export function shouldAutoComplete(
  view: SessionView,
  latestQuestion: QaQuestionView,
): boolean {
  if (view.staleQuestions.length > 0) return false;
  if (latestQuestion.order >= MAX_QUESTIONS) return true;
  if (latestQuestion.order >= MIN_QUESTIONS && latestQuestion.isFinal) return true;
  return false;
}

// ----------------------------------------------------------------------------
// Pure helpers — exported for direct use by routes / tests so the rules are
// auditable without spinning up a Prisma fixture.
// ----------------------------------------------------------------------------

/**
 * The "current answer" gate. An answer is current iff it was updated at or
 * after the question's last regeneration. A null `regeneratedAt` means the
 * question has never been regenerated, so any non-null answer is current.
 */
export function isCurrentAnswer(
  question: { regeneratedAt: Date | null },
  answer: { updatedAt: Date } | null,
): boolean {
  if (answer == null) return false;
  if (question.regeneratedAt == null) return true;
  return answer.updatedAt.getTime() >= question.regeneratedAt.getTime();
}

/** First active question that has no current answer attached. */
export function deriveCurrentQuestion(
  questions: readonly QaQuestionView[],
): QaQuestionView | null {
  return questions.find((q) => q.status === 'active' && q.answer == null) ?? null;
}

/** Questions whose status is `stale`, in source (ascending order) order. */
export function findStaleQuestions(
  questions: readonly QaQuestionView[],
): QaQuestionView[] {
  return questions.filter((q) => q.status === 'stale');
}

/**
 * Lowest `order` value among the stale questions, or null when none are stale.
 * The /next route uses this to block normal next-generation while stale
 * questions are pending.
 */
export function findLowestStaleOrder(view: {
  staleQuestions: readonly QaQuestionView[];
}): number | null {
  if (view.staleQuestions.length === 0) return null;
  let lowest = view.staleQuestions[0]!.order;
  for (const q of view.staleQuestions) {
    if (q.order < lowest) lowest = q.order;
  }
  return lowest;
}

/**
 * Compose the prior-answer history that the PO prompt needs. Stable text form
 * so callers don't have to know about the JSON-encoded value column.
 */
export function buildHistoryLines(view: SessionView): string[] {
  const out: string[] = [];
  for (const q of view.questions) {
    if (q.answer == null) continue;
    out.push(`Q${q.order}. ${q.prompt}`);
    out.push(`A${q.order}. ${formatAnswerForHistory(q.answer)}`);
  }
  return out;
}

function formatAnswerForHistory(a: QaAnswerView): string {
  if (a.choiceIndex === 6 && a.customText) {
    return `(custom) ${a.customText}`;
  }
  if (
    a.isAutoJudged &&
    typeof a.value === 'object' &&
    a.value &&
    'rationale' in (a.value as Record<string, unknown>)
  ) {
    const v = a.value as { chosenValue?: unknown; rationale?: string };
    return `(auto-judge) ${JSON.stringify(v.chosenValue ?? null)} — ${v.rationale ?? ''}`;
  }
  return JSON.stringify(a.value ?? null);
}
