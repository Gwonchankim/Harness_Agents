import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rollupTaskAttempts, type AttemptSummaryRow } from './attemptSummary';

function row(n: number, status: string, source: string, extra: Partial<AttemptSummaryRow> = {}): AttemptSummaryRow {
  return { attemptNumber: n, status, source, durationMs: null, resultBytes: null, error: null, ...extra };
}

test('rollupTaskAttempts: empty → zeros', () => {
  const r = rollupTaskAttempts([]);
  assert.equal(r.count, 0);
  assert.deepEqual(r.statusCounts, {});
  assert.deepEqual(r.sourceCounts, {});
  assert.equal(r.failedCount, 0);
  assert.equal(r.latestStatus, null);
  assert.equal(r.latestSource, null);
  assert.equal(r.reran, false);
  assert.equal(r.resumed, false);
  assert.equal(r.autoResumed, false);
  assert.equal(r.totalDurationMs, null);
  assert.equal(r.latestResultBytes, null);
});

test('rollupTaskAttempts: single initial done', () => {
  const r = rollupTaskAttempts([row(1, 'done', 'initial', { durationMs: 1000, resultBytes: 42 })]);
  assert.equal(r.count, 1);
  assert.deepEqual(r.statusCounts, { done: 1 });
  assert.deepEqual(r.sourceCounts, { initial: 1 });
  assert.equal(r.failedCount, 0);
  assert.equal(r.latestStatus, 'done');
  assert.equal(r.latestSource, 'initial');
  assert.equal(r.totalDurationMs, 1000);
  assert.equal(r.latestResultBytes, 42);
});

test('rollupTaskAttempts: counts statuses/sources, failed+cancelled, totals, latest by attemptNumber', () => {
  const r = rollupTaskAttempts([
    row(1, 'failed', 'initial', { durationMs: 200, error: 'boom' }),
    row(2, 'cancelled', 'resume', { durationMs: 50 }),
    row(3, 'done', 'rerun_from_task', { durationMs: 800, resultBytes: 10 }),
  ]);
  assert.equal(r.count, 3);
  assert.deepEqual(r.statusCounts, { failed: 1, cancelled: 1, done: 1 });
  assert.deepEqual(r.sourceCounts, { initial: 1, resume: 1, rerun_from_task: 1 });
  assert.equal(r.failedCount, 2);
  assert.equal(r.latestStatus, 'done');
  assert.equal(r.latestSource, 'rerun_from_task');
  assert.equal(r.reran, true);
  assert.equal(r.resumed, true);
  assert.equal(r.autoResumed, false);
  assert.equal(r.totalDurationMs, 1050);
  assert.equal(r.latestResultBytes, 10);
});

test('rollupTaskAttempts: auto_resume flag + unordered latest', () => {
  const r = rollupTaskAttempts([row(2, 'done', 'auto_resume'), row(1, 'failed', 'initial')]);
  assert.equal(r.autoResumed, true);
  assert.equal(r.latestStatus, 'done');
  assert.equal(r.latestSource, 'auto_resume');
});

test('rollupTaskAttempts: totalDurationMs null when no durations present', () => {
  const r = rollupTaskAttempts([row(1, 'done', 'initial'), row(2, 'done', 'rerun_from_task')]);
  assert.equal(r.totalDurationMs, null);
});
