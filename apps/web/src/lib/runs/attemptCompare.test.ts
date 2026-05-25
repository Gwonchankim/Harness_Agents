import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolveComparePair, selectComparison } from './attemptCompare';

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

const three = [
  { attemptNumber: 1, status: 'done' },
  { attemptNumber: 2, status: 'failed' },
  { attemptNumber: 3, status: 'done' },
];

test('resolveComparePair: both numbers valid → ordered (previous=lower, latest=higher)', () => {
  assert.deepEqual(resolveComparePair(three, 1, 3), {
    previous: { attemptNumber: 1, status: 'done' },
    latest: { attemptNumber: 3, status: 'done' },
  });
});

test('resolveComparePair: reversed selection normalizes by attemptNumber', () => {
  assert.deepEqual(resolveComparePair(three, 3, 1), {
    previous: { attemptNumber: 1, status: 'done' },
    latest: { attemptNumber: 3, status: 'done' },
  });
});

test('resolveComparePair: honors explicit selection even for non-terminal status', () => {
  const withRunning = [
    { attemptNumber: 1, status: 'done' },
    { attemptNumber: 2, status: 'running' },
  ];
  assert.deepEqual(resolveComparePair(withRunning, 1, 2), {
    previous: { attemptNumber: 1, status: 'done' },
    latest: { attemptNumber: 2, status: 'running' },
  });
});

test('resolveComparePair: same number → falls back to default', () => {
  assert.deepEqual(resolveComparePair(three, 2, 2), selectComparison(three));
});

test('resolveComparePair: missing number → falls back to default', () => {
  assert.deepEqual(resolveComparePair(three, 1, 99), selectComparison(three));
});

test('resolveComparePair: no selection → default latest vs previous', () => {
  assert.deepEqual(resolveComparePair(three), selectComparison(three));
});

