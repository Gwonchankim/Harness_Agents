'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useReducer } from 'react';

import type { SessionView } from '@lib/qa/sessionState';

import { QuestionCard } from './QuestionCard';
import { Timeline } from './Timeline';

interface Props {
  initial: SessionView;
}

interface State {
  view: SessionView;
  busy: boolean;
  error: string | null;
  /** When set, the user has clicked Edit on a non-current question — the
   *  answer flow will allow re-answering even though Timeline shows it as
   *  already answered. */
  editingQuestionId: string | null;
}

type Action =
  | { type: 'SET_VIEW'; view: SessionView }
  | { type: 'SET_BUSY'; busy: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'BEGIN_EDIT'; questionId: string }
  | { type: 'END_EDIT' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, view: action.view, error: null };
    case 'SET_BUSY':
      return { ...state, busy: action.busy };
    case 'SET_ERROR':
      return { ...state, error: action.error, busy: false };
    case 'BEGIN_EDIT':
      return { ...state, editingQuestionId: action.questionId };
    case 'END_EDIT':
      return { ...state, editingQuestionId: null };
  }
}

export function QaFlow({ initial }: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, {
    view: initial,
    busy: false,
    error: null,
    editingQuestionId: null,
  });

  // Phase 3: when the session reaches the completed state, hand off to the
  // compose page. The redirect is client-side so the user sees the QA panel
  // until their last answer is acknowledged.
  useEffect(() => {
    if (state.view.isComplete) {
      router.push(`/runs/new/${state.view.sessionId}/compose` as never);
    }
  }, [state.view.isComplete, state.view.sessionId, router]);

  // On mount and after every change, if there's no current question and the
  // session isn't complete and there's no stale question outstanding, ask the
  // server for the next one (idempotent).
  useEffect(() => {
    if (state.busy) return;
    if (state.view.isComplete) return;
    if (state.view.currentQuestion) return;
    if (state.view.staleQuestions.length > 0) return;
    if (state.editingQuestionId) return;
    void requestNext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.view.sessionId,
    state.view.questions.length,
    state.view.staleQuestions.length,
    state.editingQuestionId,
  ]);

  async function requestNext() {
    dispatch({ type: 'SET_BUSY', busy: true });
    try {
      const res = await fetch(`/api/qa/${state.view.sessionId}/next`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === 'stale_questions_pending') {
          // Don't reload — leave the user on the timeline so they can hit the
          // Regenerate buttons. Surface a clear inline message.
          dispatch({
            type: 'SET_ERROR',
            error: 'Regenerate stale questions before continuing.',
          });
          return;
        }
        dispatch({
          type: 'SET_ERROR',
          error: data.error ?? `HTTP ${res.status}`,
        });
        return;
      }
      // Reload the page-level snapshot via location refresh-equivalent: just
      // re-issue the next call (idempotent) so we get the updated question.
      // This avoids a separate GET endpoint in the MVP.
      location.reload();
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false });
    }
  }

  async function regenerate(order: number) {
    dispatch({ type: 'SET_BUSY', busy: true });
    try {
      const res = await fetch(`/api/qa/${state.view.sessionId}/next`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ regenerateOrder: order }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        dispatch({
          type: 'SET_ERROR',
          error: (data as { error?: string }).error ?? `HTTP ${res.status}`,
        });
        return;
      }
      location.reload();
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false });
    }
  }

  async function submit(input: {
    questionId: string;
    choiceIndex?: number;
    customText?: string;
    skip?: boolean;
  }) {
    dispatch({ type: 'SET_BUSY', busy: true });
    try {
      const res = await fetch(`/api/qa/${state.view.sessionId}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        dispatch({
          type: 'SET_ERROR',
          error: (data as { error?: string }).error ?? `HTTP ${res.status}`,
        });
        return;
      }
      const data = (await res.json()) as { session: SessionView };
      dispatch({ type: 'SET_VIEW', view: data.session });
      dispatch({ type: 'END_EDIT' });
    } finally {
      dispatch({ type: 'SET_BUSY', busy: false });
    }
  }

  const stalePending = state.view.staleQuestions.length > 0;

  // Pick the question to render in the active card. While stale questions are
  // pending we hide the active card entirely so the user is steered to the
  // Timeline's Regenerate buttons.
  const active =
    state.editingQuestionId != null
      ? (state.view.questions.find((q) => q.id === state.editingQuestionId) ?? null)
      : stalePending
        ? null
        : state.view.currentQuestion;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs opacity-70">
          <span>
            Progress: {state.view.maxAnsweredOrder} / 6
            {stalePending ? ` (${state.view.staleQuestions.length} stale)` : ''}
          </span>
          <span>
            {state.view.isComplete
              ? 'Session completed'
              : state.busy
                ? 'Working…'
                : 'Active'}
          </span>
        </div>
        {state.error ? <p className="text-xs text-rose-500">{state.error}</p> : null}
        {stalePending && state.editingQuestionId == null ? (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            Regenerate stale questions before continuing.
          </p>
        ) : null}
      </div>

      {state.view.isComplete ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          QA session complete. Redirecting to team composition…
        </div>
      ) : active ? (
        <QuestionCard question={active} busy={state.busy} onSubmit={submit} />
      ) : stalePending ? (
        <p className="text-xs opacity-60">
          Use the timeline below to regenerate the stale questions, then continue.
        </p>
      ) : (
        <p className="text-xs opacity-60">Loading next question…</p>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">Timeline</h2>
        <Timeline
          questions={state.view.questions}
          busy={state.busy}
          onEdit={(id) => dispatch({ type: 'BEGIN_EDIT', questionId: id })}
          onRegenerate={regenerate}
        />
      </div>
    </div>
  );
}
