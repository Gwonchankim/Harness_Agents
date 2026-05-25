// Pure TaskAttempt summary for the report builders (Phase 14). Summary only — the
// full per-attempt output (resultText) is never queried, passed, or rendered here;
// full-text comparison stays in the Phase 12 AttemptHistory UI.

export interface AttemptSummaryRow {
  attemptNumber: number;
  status: string; // running | done | failed | cancelled
  source: string; // initial | resume | rerun_from_task | auto_resume
  durationMs: number | null;
  resultBytes: number | null;
  error: string | null;
}

export interface TaskAttemptRollup {
  count: number;
  statusCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  failedCount: number; // failed + cancelled attempts
  latestStatus: string | null;
  latestSource: string | null;
  reran: boolean; // any rerun_from_task attempt
  resumed: boolean; // any resume attempt
  autoResumed: boolean; // any auto_resume attempt
  totalDurationMs: number | null;
  latestResultBytes: number | null;
}

export function rollupTaskAttempts(attempts: readonly AttemptSummaryRow[]): TaskAttemptRollup {
  const statusCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  let failedCount = 0;
  let totalDurationMs: number | null = null;
  let latest: AttemptSummaryRow | null = null;

  for (const a of attempts) {
    statusCounts[a.status] = (statusCounts[a.status] ?? 0) + 1;
    sourceCounts[a.source] = (sourceCounts[a.source] ?? 0) + 1;
    if (a.status === 'failed' || a.status === 'cancelled') failedCount += 1;
    if (a.durationMs != null) totalDurationMs = (totalDurationMs ?? 0) + a.durationMs;
    if (!latest || a.attemptNumber > latest.attemptNumber) latest = a;
  }

  return {
    count: attempts.length,
    statusCounts,
    sourceCounts,
    failedCount,
    latestStatus: latest?.status ?? null,
    latestSource: latest?.source ?? null,
    reran: (sourceCounts['rerun_from_task'] ?? 0) > 0,
    resumed: (sourceCounts['resume'] ?? 0) > 0,
    autoResumed: (sourceCounts['auto_resume'] ?? 0) > 0,
    totalDurationMs,
    latestResultBytes: latest?.resultBytes ?? null,
  };
}
