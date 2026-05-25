import assert from 'node:assert/strict';
import { test } from 'node:test';

import { nextAttemptNumber } from './taskAttempt';

test('nextAttemptNumber: empty → 1', () => {
  assert.equal(nextAttemptNumber([]), 1);
});

test('nextAttemptNumber: contiguous → max+1', () => {
  assert.equal(nextAttemptNumber([1, 2, 3]), 4);
});

test('nextAttemptNumber: gap uses max+1 (does not fill the gap)', () => {
  assert.equal(nextAttemptNumber([1, 3]), 4);
});

test('nextAttemptNumber: unordered input', () => {
  assert.equal(nextAttemptNumber([3, 1, 2]), 4);
});

test('nextAttemptNumber: single', () => {
  assert.equal(nextAttemptNumber([5]), 6);
});
