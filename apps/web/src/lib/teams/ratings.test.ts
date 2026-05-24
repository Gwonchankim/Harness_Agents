import assert from 'node:assert/strict';
import { test } from 'node:test';

import { aggregateAgentRatings, averageOf } from './ratings';

test('aggregateAgentRatings: groups and averages by agent', () => {
  const m = aggregateAgentRatings([
    { agentId: 'a', rating: 4 },
    { agentId: 'a', rating: 2 },
    { agentId: 'b', rating: 5 },
  ]);
  assert.deepEqual(m.get('a'), { avg: 3, count: 2 });
  assert.deepEqual(m.get('b'), { avg: 5, count: 1 });
  assert.equal(m.has('c'), false);
});

test('aggregateAgentRatings: empty input → empty map', () => {
  assert.equal(aggregateAgentRatings([]).size, 0);
});

test('aggregateAgentRatings: rounds to 2 decimals', () => {
  const m = aggregateAgentRatings([
    { agentId: 'a', rating: 5 },
    { agentId: 'a', rating: 5 },
    { agentId: 'a', rating: 4 },
  ]);
  assert.equal(m.get('a')?.avg, 4.67);
});

test('averageOf: empty → null', () => {
  assert.equal(averageOf([]), null);
});

test('averageOf: rounds to 2 decimals', () => {
  assert.equal(averageOf([5, 4, 4]), 4.33);
  assert.equal(averageOf([3, 3]), 3);
});
