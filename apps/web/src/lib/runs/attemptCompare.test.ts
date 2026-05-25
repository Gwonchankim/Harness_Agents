import assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectComparison } from './attemptCompare';

test('selectComparison: empty → null', () => {
  assert.equal(selectComparison([]), null);
});

test('selectComparison: single terminal → null (nothing to compare)', () => {
  assert.equal(selectComparison([{ attemptNumber: 1, status: 'done' }]), null);
});

test('selectComparison: two done → latest vs previous by attemptNumber', () => {
  const r = selectComparison([
    { attemptNumber: 1, status: 'done' },
    { attemptNumber: 2, status: 'done' },
  ]);
  assert.deepEqual(r, {
    latest: { attemptNumber: 2, status: 'done' },
    previous: { attemptNumber: 1, status: 'done' },
  });
});

test('selectComparison: skips running, picks terminal pair (done+failed)', () => {
  const r = selectComparison([
    { attemptNumber: 1, status: 'done' },
    { attemptNumber: 2, status: 'failed' },
    { attemptNumber: 3, status: 'running' },
  ]);
  assert.deepEqual(r, {
    latest: { attemptNumber: 2, status: 'failed' },
    previous: { attemptNumber: 1, status: 'done' },
  });
});

test('selectComparison: only running/cancelled → null', () => {
  assert.equal(
    selectComparison([
      { attemptNumber: 1, status: 'cancelled' },
      { attemptNumber: 2, status: 'running' },
    ]),
    null,
  );
});

test('selectComparison: unordered input picks top two by number', () => {
  const r = selectComparison([
    { attemptNumber: 3, status: 'done' },
    { attemptNumber: 1, status: 'done' },
    { attemptNumber: 2, status: 'done' },
  ]);
  assert.equal(r?.latest.attemptNumber, 3);
  assert.equal(r?.previous.attemptNumber, 2);
});
