'use client';

import { useState } from 'react';

import type { QaQuestionView } from '@lib/qa/sessionState';

interface Props {
  question: QaQuestionView;
  busy: boolean;
  onSubmit: (input: {
    questionId: string;
    choiceIndex?: number;
    customText?: string;
    skip?: boolean;
  }) => void;
}

export function QuestionCard({ question, busy, onSubmit }: Props) {
  const [customText, setCustomText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const choices = question.options.filter((o) => o.kind === 'choice');

  function pick(choiceIndex: number) {
    // Belt-and-braces: even when the disabled buttons should swallow the
    // click, this stops any lingering event from double-submitting.
    if (busy) return;
    setError(null);
    if (choiceIndex === 6) {
      const text = customText.trim();
      if (text.length === 0) {
        setError('Custom answer is empty');
        return;
      }
      onSubmit({ questionId: question.id, choiceIndex: 6, customText: text });
      return;
    }
    onSubmit({ questionId: question.id, choiceIndex });
  }

  return (
    <div className="rounded-lg border border-current/15 p-5">
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide opacity-60">
          Question {question.order}
          {question.isFinal ? ' · final' : ''}
        </div>
        <h2 className="text-base font-medium">{question.prompt}</h2>
      </div>

      <ul className="mt-4 space-y-2">
        {choices.map((option, idx) => {
          const i = idx + 1;
          return (
            <li key={i}>
              <button
                type="button"
                disabled={busy}
                onClick={() => pick(i)}
                className="flex w-full items-start gap-3 rounded-md border border-current/15 px-3 py-2 text-left text-sm hover:bg-current/5 disabled:opacity-40"
              >
                <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs">
                  {i}
                </span>
                <span className="flex-1">{option.label}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            disabled={busy}
            onClick={() => pick(5)}
            className="flex w-full items-start gap-3 rounded-md border border-current/15 px-3 py-2 text-left text-sm hover:bg-current/5 disabled:opacity-40"
          >
            <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs">5</span>
            <span className="flex-1">AI auto-judge</span>
          </button>
        </li>
        <li className="space-y-2">
          <div
            aria-disabled={busy}
            className={`flex items-start gap-3 rounded-md border border-current/15 px-3 py-2 transition-opacity ${
              busy ? 'cursor-not-allowed opacity-40' : ''
            }`}
          >
            <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs">6</span>
            <div className="flex-1 space-y-2">
              <label className="text-sm">Custom answer</label>
              <textarea
                disabled={busy}
                rows={2}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Type your own answer…"
                className="w-full resize-y rounded-md border border-current/20 bg-transparent px-2 py-1 text-sm outline-none focus:border-current/50 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                type="button"
                disabled={busy}
                aria-disabled={busy}
                onClick={() => pick(6)}
                className="rounded-md border border-current/30 px-3 py-1 text-xs font-medium hover:bg-current/5 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Submit custom answer
              </button>
            </div>
          </div>
        </li>
      </ul>

      <div className="mt-4 flex items-center justify-between">
        <button
          type="button"
          disabled={busy}
          aria-disabled={busy}
          onClick={() => onSubmit({ questionId: question.id, skip: true })}
          className="text-xs underline opacity-70 hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline"
        >
          Skip (use AI auto-judge)
        </button>
        {error ? <p className="text-xs text-rose-500">{error}</p> : null}
      </div>
    </div>
  );
}
