import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextBackoff } from './backoffPolicy';

test('nextBackoff: rate_limit retries twice with growing delay', () => {
  assert.deepEqual(nextBackoff('rate_limit', 1), { retry: true, delayMs: 2000 });
  assert.deepEqual(nextBackoff('rate_limit', 2), { retry: true, delayMs: 4000 });
  assert.deepEqual(nextBackoff('rate_limit', 3), { retry: false, delayMs: 0 });
});

test('nextBackoff: timeout retries once', () => {
  assert.deepEqual(nextBackoff('timeout', 1), { retry: true, delayMs: 5000 });
  assert.deepEqual(nextBackoff('timeout', 2), { retry: false, delayMs: 0 });
});

test('nextBackoff: persistent kinds never retry', () => {
  for (const kind of [
    'auth',
    'schema',
    'model_not_found',
    'provider_unavailable',
    'abort',
  ] as const) {
    assert.deepEqual(nextBackoff(kind, 1), { retry: false, delayMs: 0 });
  }
});

test('nextBackoff: attemptsSoFar < 1 never retries', () => {
  assert.equal(nextBackoff('rate_limit', 0).retry, false);
});

test('nextBackoff: env override caps retries', () => {
  const prev = process.env.HARNESS_TASK_RETRY_RATE_LIMIT_MAX;
  process.env.HARNESS_TASK_RETRY_RATE_LIMIT_MAX = '0';
  try {
    assert.equal(nextBackoff('rate_limit', 1).retry, false);
  } finally {
    if (prev == null) delete process.env.HARNESS_TASK_RETRY_RATE_LIMIT_MAX;
    else process.env.HARNESS_TASK_RETRY_RATE_LIMIT_MAX = prev;
  }
});

test('nextBackoff: retryAfterMs overrides exponential, capped at maxDelay', () => {
  // Suggested wait beats the exponential schedule.
  assert.deepEqual(nextBackoff('rate_limit', 1, { retryAfterMs: 9000 }), {
    retry: true,
    delayMs: 9000,
  });
  // Capped at the 30s ceiling.
  assert.deepEqual(nextBackoff('rate_limit', 1, { retryAfterMs: 999_999 }), {
    retry: true,
    delayMs: 30_000,
  });
  // Falls back to exponential when absent / non-positive.
  assert.deepEqual(nextBackoff('rate_limit', 1, { retryAfterMs: 0 }), {
    retry: true,
    delayMs: 2000,
  });
  assert.deepEqual(nextBackoff('rate_limit', 2, {}), { retry: true, delayMs: 4000 });
});

test('nextBackoff: retryAfterMs does not resurrect a non-retryable kind', () => {
  assert.deepEqual(nextBackoff('auth', 1, { retryAfterMs: 5000 }), { retry: false, delayMs: 0 });
});
