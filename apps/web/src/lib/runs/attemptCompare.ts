// Pure selection of the two attempts to diff (Phase 11): the latest terminal
// attempt vs the one immediately before it (by attemptNumber). running/cancelled
// attempts have no comparable output and are skipped. Returns null when there is
// no pair to compare (the UI then just shows the single attempt / degrades).

export interface ComparableAttempt {
  attemptNumber: number;
  status: string;
}

export function selectComparison<T extends ComparableAttempt>(
  attempts: readonly T[],
): { latest: T; previous: T } | null {
  const terminal = attempts
    .filter((a) => a.status === 'done' || a.status === 'failed')
    .slice()
    .sort((a, b) => b.attemptNumber - a.attemptNumber);
  if (terminal.length < 2) return null;
  return { latest: terminal[0]!, previous: terminal[1]! };
}

// Phase 12: resolve the two attempts to diff. When the user explicitly picks two
// distinct attemptNumbers (both present), honor that selection ordered by number
// (previous = lower, latest = higher). Otherwise fall back to the default
// latest-vs-previous (`selectComparison`). Returns null when no pair is available.
export function resolveComparePair<T extends ComparableAttempt>(
  attempts: readonly T[],
  aNum?: number | null,
  bNum?: number | null,
): { previous: T; latest: T } | null {
  if (aNum != null && bNum != null && aNum !== bNum) {
    const a = attempts.find((x) => x.attemptNumber === aNum);
    const b = attempts.find((x) => x.attemptNumber === bNum);
    if (a && b) {
      return a.attemptNumber < b.attemptNumber
        ? { previous: a, latest: b }
        : { previous: b, latest: a };
    }
  }
  return selectComparison(attempts);
}
