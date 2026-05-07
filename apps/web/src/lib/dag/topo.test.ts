import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CycleDetectedError,
  DuplicateTaskKeyError,
  MissingDependencyError,
  topoSort,
} from './topo';

test('topoSort: empty input returns empty array', () => {
  const result = topoSort([]);
  assert.deepEqual(result, []);
});

test('topoSort: single node with no deps', () => {
  const result = topoSort([{ taskKey: 'a', dependencies: [] }]);
  assert.deepEqual(
    result.map((r) => r.taskKey),
    ['a'],
  );
});

test('topoSort: linear chain a -> b -> c (input order reversed)', () => {
  const result = topoSort([
    { taskKey: 'c', dependencies: ['b'] },
    { taskKey: 'b', dependencies: ['a'] },
    { taskKey: 'a', dependencies: [] },
  ]);
  assert.deepEqual(
    result.map((r) => r.taskKey),
    ['a', 'b', 'c'],
  );
});

test('topoSort: branching plan resolves in dependency order', () => {
  const result = topoSort([
    { taskKey: 'd', dependencies: ['b', 'c'] },
    { taskKey: 'c', dependencies: ['a'] },
    { taskKey: 'b', dependencies: ['a'] },
    { taskKey: 'a', dependencies: [] },
  ]);
  const order = result.map((r) => r.taskKey);
  assert.equal(order[0], 'a');
  assert.equal(order[order.length - 1], 'd');
  assert.ok(order.indexOf('b') < order.indexOf('d'));
  assert.ok(order.indexOf('c') < order.indexOf('d'));
});

test('topoSort: detects a 2-node cycle', () => {
  assert.throws(
    () =>
      topoSort([
        { taskKey: 'a', dependencies: ['b'] },
        { taskKey: 'b', dependencies: ['a'] },
      ]),
    CycleDetectedError,
  );
});

test('topoSort: detects a self-loop', () => {
  assert.throws(
    () => topoSort([{ taskKey: 'a', dependencies: ['a'] }]),
    CycleDetectedError,
  );
});

test('topoSort: detects a 3-node cycle', () => {
  assert.throws(
    () =>
      topoSort([
        { taskKey: 'a', dependencies: ['c'] },
        { taskKey: 'b', dependencies: ['a'] },
        { taskKey: 'c', dependencies: ['b'] },
      ]),
    CycleDetectedError,
  );
});

test('topoSort: rejects duplicate task keys', () => {
  assert.throws(
    () =>
      topoSort([
        { taskKey: 'a', dependencies: [] },
        { taskKey: 'a', dependencies: [] },
      ]),
    DuplicateTaskKeyError,
  );
});

test('topoSort: rejects missing dependency', () => {
  assert.throws(
    () => topoSort([{ taskKey: 'a', dependencies: ['ghost'] }]),
    MissingDependencyError,
  );
});

test('topoSort: diamond shape resolves with single source and sink', () => {
  const result = topoSort([
    { taskKey: 'a', dependencies: [] },
    { taskKey: 'b', dependencies: ['a'] },
    { taskKey: 'c', dependencies: ['a'] },
    { taskKey: 'd', dependencies: ['b', 'c'] },
  ]);
  const order = result.map((r) => r.taskKey);
  assert.equal(order.length, 4);
  assert.equal(order[0], 'a');
  assert.equal(order[order.length - 1], 'd');
});

test('topoSort: independent islands both appear', () => {
  const result = topoSort([
    { taskKey: 'a', dependencies: [] },
    { taskKey: 'b', dependencies: [] },
  ]);
  assert.deepEqual(
    result.map((r) => r.taskKey).sort(),
    ['a', 'b'],
  );
});
