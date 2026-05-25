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
