import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  deriveCurrentQuestion,
  findLowestStaleOrder,
  findStaleQuestions,
  isCurrentAnswer,
  shouldAutoComplete,
  type QaAnswerView,
  type QaQuestionView,
  type SessionView,
} from './sessionState';

const baseDate = new Date('2026-05-06T00:00:00.000Z');

function makeAnswer(overrides: Partial<QaAnswerView> = {}): QaAnswerView {
  return {
    id: 'a1',
    choiceIndex: 1,
    customText: null,
    value: null,
    isAutoJudged: false,
    createdAt: baseDate,
    updatedAt: baseDate,
    ...overrides,
  };
}

function makeQuestion(overrides: Partial<QaQuestionView> = {}): QaQuestionView {
  return {
    id: 'q' + (overrides.order ?? 1),
    order: 1,
    prompt: 'placeholder',
    kind: 'single',
    options: [],
    status: 'active',
    staleAt: null,
    regeneratedAt: null,
    isFinal: false,
    createdAt: baseDate,
    answer: null,
    ...overrides,
  };
}

function makeView(
  questions: QaQuestionView[],
  status: SessionView['status'] = 'active',
): SessionView {
  return {
    sessionId: 's1',
    runId: 'r1',
    status,
    questions,
    currentQuestion: deriveCurrentQuestion(questions),
    staleQuestions: findStaleQuestions(questions),
    maxAnsweredOrder: questions
      .filter((q) => q.answer != null)
      .reduce((m, q) => (q.order > m ? q.order : m), 0),
    isComplete: status === 'completed',
  };
}

// ---------------------------------------------------------------------------
// isCurrentAnswer — gate using updatedAt >= regeneratedAt
// ---------------------------------------------------------------------------

test('isCurrentAnswer: null answer is never current', () => {
  assert.equal(isCurrentAnswer({ regeneratedAt: null }, null), false);
  assert.equal(isCurrentAnswer({ regeneratedAt: baseDate }, null), false);
});

test('isCurrentAnswer: regeneratedAt null with any answer is current', () => {
  const answer = makeAnswer({ updatedAt: new Date('2020-01-01T00:00:00Z') });
  assert.equal(isCurrentAnswer({ regeneratedAt: null }, answer), true);
});

test('isCurrentAnswer: answer.updatedAt before regeneratedAt is stale', () => {
  const regeneratedAt = new Date('2026-05-06T12:00:00Z');
  const answer = makeAnswer({ updatedAt: new Date('2026-05-06T11:00:00Z') });
  assert.equal(isCurrentAnswer({ regeneratedAt }, answer), false);
});

test('isCurrentAnswer: answer.updatedAt equal to regeneratedAt is current', () => {
  const regeneratedAt = new Date('2026-05-06T12:00:00Z');
  const answer = makeAnswer({ updatedAt: regeneratedAt });
  assert.equal(isCurrentAnswer({ regeneratedAt }, answer), true);
});

test('isCurrentAnswer: answer.updatedAt after regeneratedAt is current', () => {
  const regeneratedAt = new Date('2026-05-06T12:00:00Z');
  const answer = makeAnswer({ updatedAt: new Date('2026-05-06T13:00:00Z') });
  assert.equal(isCurrentAnswer({ regeneratedAt }, answer), true);
});

// ---------------------------------------------------------------------------
// deriveCurrentQuestion — first active unanswered
// ---------------------------------------------------------------------------

test('deriveCurrentQuestion: returns the first active question without an answer', () => {
  const qs = [
    makeQuestion({ order: 1, status: 'active', answer: makeAnswer({ id: 'a1' }) }),
    makeQuestion({ order: 2, status: 'active', answer: null }),
    makeQuestion({ order: 3, status: 'active', answer: null }),
  ];
  const current = deriveCurrentQuestion(qs);
  assert.equal(current?.order, 2);
});

test('deriveCurrentQuestion: returns null when all active questions are answered', () => {
  const qs = [
    makeQuestion({ order: 1, status: 'active', answer: makeAnswer({ id: 'a1' }) }),
    makeQuestion({ order: 2, status: 'active', answer: makeAnswer({ id: 'a2' }) }),
  ];
  assert.equal(deriveCurrentQuestion(qs), null);
});

test('deriveCurrentQuestion: skips stale questions even if unanswered', () => {
  const qs = [
    makeQuestion({ order: 1, status: 'stale', answer: null, staleAt: baseDate }),
    makeQuestion({ order: 2, status: 'active', answer: null }),
  ];
  assert.equal(deriveCurrentQuestion(qs)?.order, 2);
});

// ---------------------------------------------------------------------------
// findStaleQuestions — only status==='stale', source order
// ---------------------------------------------------------------------------

test('findStaleQuestions: filters by status, preserves source order', () => {
  const qs = [
    makeQuestion({ order: 1, status: 'active' }),
    makeQuestion({ order: 2, status: 'stale', staleAt: baseDate }),
    makeQuestion({ order: 3, status: 'active' }),
    makeQuestion({ order: 4, status: 'stale', staleAt: baseDate }),
  ];
  const stale = findStaleQuestions(qs);
  assert.deepEqual(
    stale.map((q) => q.order),
    [2, 4],
  );
});

test('findStaleQuestions: returns empty array when none are stale', () => {
  const qs = [makeQuestion({ order: 1, status: 'active' })];
  assert.deepEqual(findStaleQuestions(qs), []);
});

// ---------------------------------------------------------------------------
// findLowestStaleOrder — guards the /api/qa/.../next route
// ---------------------------------------------------------------------------

test('findLowestStaleOrder: returns null when no stale questions', () => {
  const view = makeView([
    makeQuestion({ order: 1, status: 'active' }),
    makeQuestion({ order: 2, status: 'active' }),
  ]);
  assert.equal(findLowestStaleOrder(view), null);
});

test('findLowestStaleOrder: returns the smallest stale order', () => {
  const view = makeView([
    makeQuestion({ order: 1, status: 'active' }),
    makeQuestion({ order: 2, status: 'stale', staleAt: baseDate }),
    makeQuestion({ order: 3, status: 'stale', staleAt: baseDate }),
    makeQuestion({ order: 4, status: 'stale', staleAt: baseDate }),
  ]);
  assert.equal(findLowestStaleOrder(view), 2);
});

test('findLowestStaleOrder: indifferent to source ordering', () => {
  const view = makeView([
    makeQuestion({ order: 5, status: 'stale', staleAt: baseDate }),
    makeQuestion({ order: 3, status: 'stale', staleAt: baseDate }),
    makeQuestion({ order: 4, status: 'stale', staleAt: baseDate }),
  ]);
  assert.equal(findLowestStaleOrder(view), 3);
});

// ---------------------------------------------------------------------------
// shouldAutoComplete — MVP rule: (order>=5 && isFinal) || order===6, no stale
// ---------------------------------------------------------------------------

test('shouldAutoComplete: order 6 with no stale completes', () => {
  const q6 = makeQuestion({ order: 6, isFinal: false });
  const view = makeView([q6]);
  assert.equal(shouldAutoComplete(view, q6), true);
});

test('shouldAutoComplete: order 5 with isFinal completes', () => {
  const q5 = makeQuestion({ order: 5, isFinal: true });
  const view = makeView([q5]);
  assert.equal(shouldAutoComplete(view, q5), true);
});

test('shouldAutoComplete: order 5 without isFinal does not complete', () => {
  const q5 = makeQuestion({ order: 5, isFinal: false });
  const view = makeView([q5]);
  assert.equal(shouldAutoComplete(view, q5), false);
});

test('shouldAutoComplete: order 4 even with isFinal does not complete', () => {
  const q4 = makeQuestion({ order: 4, isFinal: true });
  const view = makeView([q4]);
  assert.equal(shouldAutoComplete(view, q4), false);
});

test('shouldAutoComplete: stale pending blocks completion at order 6', () => {
  const q3 = makeQuestion({ order: 3, status: 'stale', staleAt: baseDate });
  const q6 = makeQuestion({ order: 6, isFinal: true });
  const view = makeView([q3, q6]);
  assert.equal(shouldAutoComplete(view, q6), false);
});

// ---------------------------------------------------------------------------
// Stale pending prevents normal next generation — composes findLowestStaleOrder
// ---------------------------------------------------------------------------

test('stale pending prevents normal next generation: lowestStaleOrder is exposed', () => {
  const q2 = makeQuestion({ order: 2, status: 'stale', staleAt: baseDate });
  const q3 = makeQuestion({ order: 3, status: 'stale', staleAt: baseDate });
  const view = makeView([
    makeQuestion({ order: 1, status: 'active', answer: makeAnswer() }),
    q2,
    q3,
  ]);
  // The /next route uses this exact predicate to gate generation.
  const lowest = findLowestStaleOrder(view);
  assert.equal(lowest, 2);
});
