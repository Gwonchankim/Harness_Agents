'use client';

// Reusable 1–5 rating selector. Used by the result feedback and each agent card.

interface Props {
  value: number | null;
  onChange: (n: number) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function RatingInput({ value, onChange, disabled, ariaLabel }: Props) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={ariaLabel ?? 'Rating 1 to 5'}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={disabled}
          aria-pressed={value === n}
          onClick={() => onChange(n)}
          className={`h-8 w-8 rounded-md border text-sm transition ${
            value === n
              ? 'border-neutral-950 bg-neutral-950 text-white dark:border-white dark:bg-white dark:text-neutral-950'
              : 'border-current/30 hover:bg-current/5'
          } disabled:opacity-40`}
        >
          {n}
        </button>
      ))}
      <span className="ml-2 text-xs opacity-60">{value != null ? `${value}/5` : 'no rating'}</span>
    </div>
  );
}
