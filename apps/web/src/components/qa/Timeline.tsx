'use client';

import type { QaQuestionView } from '@lib/qa/sessionState';

interface Props {
  questions: QaQuestionView[];
  busy: boolean;
  onEdit: (questionId: string) => void;
  onRegenerate: (order: number) => void;
}

export function Timeline({ questions, busy, onEdit, onRegenerate }: Props) {
  const visible = questions.filter((q) => q.answer != null || q.status === 'stale');
  if (visible.length === 0) {
    return <p className="text-xs opacity-60">No questions answered yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {visible.map((q) => (
        <li key={q.id} className="rounded-lg border border-current/15 p-4 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <span className="text-xs opacity-60">Q{q.order}</span> · {q.prompt}
            </div>
            <div className="flex items-center gap-2 text-xs">
              {q.status === 'stale' ? (
                <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-300">
                  stale
                </span>
              ) : null}
              {q.answer?.isAutoJudged ? (
                <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-sky-700 dark:text-sky-300">
                  auto-judge
                </span>
              ) : null}
            </div>
          </div>
          {q.answer ? (
            <div className="mt-2 text-xs opacity-80">
              <div>{formatAnswerSummary(q.answer)}</div>
              {q.answer.isAutoJudged && isJudgedValue(q.answer.value) ? (
                <div className="mt-1 italic opacity-70">
                  rationale: {q.answer.value.rationale}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-xs opacity-60">
              No current answer (regeneration may have orphaned the prior answer).
            </p>
          )}
          <div className="mt-3 flex gap-2 text-xs">
            {q.status === 'stale' ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRegenerate(q.order)}
                className="rounded-md border border-current/30 px-3 py-1 font-medium hover:bg-current/5 disabled:opacity-40"
              >
                Regenerate
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => onEdit(q.id)}
                className="rounded-md border border-current/20 px-3 py-1 hover:bg-current/5 disabled:opacity-40"
              >
                Edit answer
              </button>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function formatAnswerSummary(a: NonNullable<QaQuestionView['answer']>): string {
  if (a.choiceIndex === 6 && a.customText) {
    return `(custom) ${a.customText}`;
  }
  if (isMultiSelectedValue(a.value)) {
    return `(multiple) ${a.value.selectedValues
      .map((v) => `${v.choiceIndex}. ${v.label}`)
      .join('; ')}`;
  }
  if (isJudgedValue(a.value)) {
    return `chose ${JSON.stringify(a.value.chosenValue)}`;
  }
  return JSON.stringify(a.value ?? null);
}

function isMultiSelectedValue(
  v: unknown,
): v is { selectedValues: Array<{ choiceIndex: number; label: string; value: unknown }> } {
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as { selectedValues?: unknown }).selectedValues)
  );
}

function isJudgedValue(v: unknown): v is { chosenValue: unknown; rationale: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    'rationale' in (v as Record<string, unknown>) &&
    typeof (v as { rationale: unknown }).rationale === 'string'
  );
}
