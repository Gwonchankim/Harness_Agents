'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useReducer } from 'react';

import type { SessionView } from '@lib/qa/sessionState';

import { QuestionCard } from './QuestionCard';
import { Timeline } from './Timeline';

interface Props {
  initial: SessionView;
  /** Provider of the Run's poModelId. Used to show a local-models latency hint. */
  poProvider?: 'openai' | 'anthropic' | 'ollama' | null;
}

/**
 * The single in-flight operation, if any. Modelled explicitly (instead of a
 * boolean `busy`) so the status label and the interaction-lock derivation can
 * tell `Working…` (answer submit) apart from `Generating next question…`
 * (next-question request) without ever flipping through `Active` between
 * them.
 */
type PendingOperation = 'answer' | 'next' | 'regenerate';

interface State {
  view: SessionView;
  pendingOperation: PendingOperation | null;
  error: string | null;
  /** When set, the user has clicked Edit on a non-current question — the
   *  answer flow will allow re-answering even though Timeline shows it as
   *  already answered. */
  editingQuestionId: string | null;
}

type Action =
  | { type: 'SET_VIEW'; view: SessionView }
  | { type: 'SET_PENDING_OPERATION'; operation: PendingOperation | null }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'BEGIN_EDIT'; questionId: string }
  | { type: 'END_EDIT' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, view: action.view, error: null };
    case 'SET_PENDING_OPERATION':
      return { ...state, pendingOperation: action.operation };
    case 'SET_ERROR':
      // An error always ends the in-flight operation. Clearing both in one
      // action prevents an interim render with pendingOperation still set
      // alongside an error banner.
      return { ...state, error: action.error, pendingOperation: null };
    case 'BEGIN_EDIT':
      return { ...state, editingQuestionId: action.questionId };
    case 'END_EDIT':
      return { ...state, editingQuestionId: null };
  }
}

export function QaFlow({ initial, poProvider = null }: Props) {
  const router = useRouter();
  const [state, dispatch] = useReducer(reducer, {
    view: initial,
    pendingOperation: null,
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

  // requestNext is idempotent server-side (Phase 2 correction): if there is
  // already an active unanswered question for this session it returns the
  // existing one instead of generating a duplicate. We rely on that contract
  // to keep this auto-advance loop safe.
  const sessionId = state.view.sessionId;
  const requestNext = useCallback(async () => {
    dispatch({ type: 'SET_ERROR', error: null });
    dispatch({ type: 'SET_PENDING_OPERATION', operation: 'next' });
    try {
      const res = await fetch(`/api/qa/${sessionId}/next`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
        if (data.error === 'stale_questions_pending') {
          dispatch({
            type: 'SET_ERROR',
            error: 'Regenerate stale questions before continuing.',
          });
          return;
        }
        dispatch({
          type: 'SET_ERROR',
          error: formatErrorMessage(data, res.status),
        });
        return;
      }
      // Reload the page-level snapshot via location refresh-equivalent: just
      // re-issue the next call (idempotent) so we get the updated question.
      // This avoids a separate GET endpoint in the MVP.
      location.reload();
    } finally {
      dispatch({ type: 'SET_PENDING_OPERATION', operation: null });
    }
  }, [sessionId]);

  // On mount and after every state change, if there's no active current
  // question (and the session isn't complete and no stale question is
  // outstanding), ask the server for the next question.
  //
  // We DO NOT auto-retry when state.error is set. Timeout / auth / schema
  // failures stay sticky until the user explicitly hits Retry.
  const currentQuestionId = state.view.currentQuestion?.id ?? null;
  useEffect(() => {
    if (state.pendingOperation != null) return;
    if (state.error) return;
    if (state.view.isComplete) return;
    if (currentQuestionId != null) return;
    if (state.view.staleQuestions.length > 0) return;
    if (state.editingQuestionId) return;
    void requestNext();
  }, [
    state.pendingOperation,
    state.error,
    state.view.isComplete,
    currentQuestionId,
    state.view.staleQuestions.length,
    state.view.maxAnsweredOrder,
    state.editingQuestionId,
    requestNext,
  ]);

  async function regenerate(order: number) {
    dispatch({ type: 'SET_ERROR', error: null });
    dispatch({ type: 'SET_PENDING_OPERATION', operation: 'regenerate' });
    try {
      const res = await fetch(`/api/qa/${state.view.sessionId}/next`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ regenerateOrder: order }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
        dispatch({ type: 'SET_ERROR', error: formatErrorMessage(data, res.status) });
        return;
      }
      location.reload();
    } finally {
      dispatch({ type: 'SET_PENDING_OPERATION', operation: null });
    }
  }

  async function submit(input: {
    questionId: string;
    choiceIndex?: number;
    customText?: string;
    skip?: boolean;
  }) {
    dispatch({ type: 'SET_ERROR', error: null });
    dispatch({ type: 'SET_PENDING_OPERATION', operation: 'answer' });
    try {
      const res = await fetch(`/api/qa/${state.view.sessionId}/answer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
        dispatch({ type: 'SET_ERROR', error: formatErrorMessage(data, res.status) });
        return;
      }
      const data = (await res.json()) as { session: SessionView };
      dispatch({ type: 'SET_VIEW', view: data.session });
      dispatch({ type: 'END_EDIT' });
    } finally {
      // Clearing pendingOperation here lets the auto-advance useEffect kick
      // in and immediately set it to 'next'. The interim render shows
      // pendingOperation=null but the label still reads `Generating next
      // question…` because isWaitingForNextQuestion is true — no flicker
      // through `Active` is possible.
      dispatch({ type: 'SET_PENDING_OPERATION', operation: null });
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

  // We're "waiting for the next question" when no operation is in flight, no
  // error is sticky, and there's nothing to do but generate the next card.
  // The error clause is what allows the Retry button to be interactive — it
  // breaks the wait so the user can click Retry without the lock making the
  // button feel jammed.
  const isWaitingForNextQuestion =
    !state.view.isComplete &&
    !state.error &&
    state.pendingOperation == null &&
    currentQuestionId == null &&
    !stalePending &&
    state.editingQuestionId == null;
  const interactionLocked = state.pendingOperation != null || isWaitingForNextQuestion;

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs opacity-70">
          <span>
            Progress: {state.view.maxAnsweredOrder} / 6
            {stalePending ? ` (${state.view.staleQuestions.length} stale)` : ''}
          </span>
          <span>{statusLabel(state, isWaitingForNextQuestion)}</span>
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
        <QuestionCard question={active} busy={interactionLocked} onSubmit={submit} />
      ) : stalePending ? (
        <p className="text-xs opacity-60">
          Use the timeline below to regenerate the stale questions, then continue.
        </p>
      ) : state.error ? (
        <div className="space-y-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4 text-sm">
          <p className="text-rose-700 dark:text-rose-300">{state.error}</p>
          <button
            type="button"
            disabled={state.pendingOperation != null}
            onClick={() => void requestNext()}
            className="rounded-md border border-current/30 px-3 py-1 text-xs font-medium hover:bg-current/5 disabled:opacity-40"
          >
            {state.pendingOperation === 'next' ? 'Retrying…' : 'Retry next question'}
          </button>
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-xs opacity-60">Loading next question…</p>
          {poProvider === 'ollama' ? (
            <p className="text-xs opacity-60">
              Local models may take up to 120 seconds.
            </p>
          ) : null}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">Timeline</h2>
        <Timeline
          questions={state.view.questions}
          busy={interactionLocked}
          onEdit={(id) => dispatch({ type: 'BEGIN_EDIT', questionId: id })}
          onRegenerate={regenerate}
        />
      </div>
    </div>
  );
}

/**
 * Resolve the status pill label. Order matters: an in-flight operation always
 * wins over the wait-for-next-question gate, so the answer→next handoff
 * looks like `Working…` → `Generating next question…` (sustained across the
 * brief gap before the auto-advance fires).
 */
function statusLabel(state: State, isWaitingForNextQuestion: boolean): string {
  if (state.view.isComplete) return 'Session completed';
  switch (state.pendingOperation) {
    case 'answer':
      return 'Working…';
    case 'next':
      return 'Generating next question…';
    case 'regenerate':
      return 'Regenerating question…';
    case null:
      break;
  }
  if (isWaitingForNextQuestion) return 'Generating next question…';
  return 'Active';
}

interface ApiErrorBody {
  error?: string;
  timeoutMs?: number;
  provider?: string;
  modelId?: string;
}

/**
 * Build a human-readable, redacted-safe error message from an API error body.
 * Surfaces provider + modelId on timeouts so the user knows which model stalled.
 */
function formatErrorMessage(data: ApiErrorBody, status: number): string {
  if (data.error === 'timeout') {
    const seconds = data.timeoutMs ? Math.round(data.timeoutMs / 1000) : null;
    const subject =
      data.modelId && data.provider
        ? `${data.provider}/${data.modelId}`
        : (data.modelId ?? data.provider ?? 'the model');
    return seconds
      ? `Timeout after ${seconds}s waiting for ${subject}. Retry, or pick a faster model in Settings.`
      : `Timeout waiting for ${subject}. Retry, or pick a faster model in Settings.`;
  }
  if (data.error === 'provider_unavailable') {
    return `Provider ${data.provider ?? 'unknown'} is unavailable. Open Settings to fix the key.`;
  }
  if (data.error === 'provider_auth_failed') {
    return `Provider ${data.provider ?? 'unknown'} rejected the credentials. Update the key in Settings.`;
  }
  if (data.error === 'po_schema_error') {
    return 'The model returned a malformed response. Retry, or pick a stronger model.';
  }
  if (data.error) return data.error;
  return `HTTP ${status}`;
}
