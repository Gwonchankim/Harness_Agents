import assert from 'node:assert/strict';
import { test } from 'node:test';

import { transitiveDownstream } from './downstream';

const sorted = (s: Set<string>) => [...s].sort();

test('transitiveDownstream: linear chain A->B->C', () => {
  const tasks = [
    { taskKey: 'A', dependencies: [] },
    { taskKey: 'B', dependencies: ['A'] },
    { taskKey: 'C', dependencies: ['B'] },
  ];
  assert.deepEqual(sorted(transitiveDownstream(tasks, 'A')), ['B', 'C']);
  assert.deepEqual(sorted(transitiveDownstream(tasks, 'B')), ['C']);
  assert.deepEqual(sorted(transitiveDownstream(tasks, 'C')), []);
});

test('transitiveDownstream: diamond', () => {
  const tasks = [
    { taskKey: 'A', dependencies: [] },
    { taskKey: 'B', dependencies: ['A'] },
    { taskKey: 'C', dependencies: ['A'] },
    { taskKey: 'D', dependencies: ['B', 'C'] },
  ];
  assert.deepEqual(sorted(transitiveDownstream(tasks, 'A')), ['B', 'C', 'D']);
  assert.deepEqual(sorted(transitiveDownstream(tasks, 'B')), ['D']);
  assert.deepEqual(sorted(transitiveDownstream(tasks, 'D')), []);
});

test('transitiveDownstream: unknown target has no dependents', () => {
  const tasks = [{ taskKey: 'A', dependencies: [] }];
  assert.deepEqual(sorted(transitiveDownstream(tasks, 'missing')), []);
});

test('transitiveDownstream: cycle terminates', () => {
  const tasks = [
    { taskKey: 'A', dependencies: ['B'] },
    { taskKey: 'B', dependencies: ['A'] },
  ];
  const out = transitiveDownstream(tasks, 'A');
  assert.ok(out.has('B'));
});
