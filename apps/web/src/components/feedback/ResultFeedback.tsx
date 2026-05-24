'use client';

import { RatingInput } from './RatingInput';

interface Props {
  markdown: string | null;
  rating: number | null;
  comment: string;
  onRating: (n: number) => void;
  onComment: (s: string) => void;
  disabled?: boolean;
}

export function ResultFeedback({
  markdown,
  rating,
  comment,
  onRating,
  onComment,
  disabled,
}: Props) {
  return (
    <section className="space-y-4 rounded-lg border border-current/15 p-5">
      <div className="space-y-1">
        <h2 className="text-base font-medium">Result feedback</h2>
        <p className="text-sm opacity-65">Rate the final deliverable and add any notes.</p>
      </div>

      {markdown ? (
        <details className="rounded-md border border-current/10 bg-current/5">
          <summary className="cursor-pointer px-3 py-2 text-sm">Show result.md</summary>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap px-3 pb-3 text-xs leading-6">
            {markdown}
          </pre>
        </details>
      ) : (
        <p className="text-sm opacity-60">No result content available.</p>
      )}

      <div className="space-y-2">
        <span className="block text-sm font-medium">Score</span>
        <RatingInput
          value={rating}
          onChange={onRating}
          disabled={disabled}
          ariaLabel="Result rating"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="result-comment" className="block text-sm font-medium">
          Comment <span className="opacity-50">(optional)</span>
        </label>
        <textarea
          id="result-comment"
          value={comment}
          onChange={(e) => onComment(e.target.value)}
          disabled={disabled}
          rows={3}
          maxLength={4000}
          className="w-full rounded-md border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50 disabled:opacity-50"
          placeholder="What was good, or what should improve?"
        />
      </div>
    </section>
  );
}
