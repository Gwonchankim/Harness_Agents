import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeResumePlan } from './resumePlan';

const tasks = [
  { taskKey: 'a', status: 'done', dependencies: [] },
  { taskKey: 'b', status: 'done', dependencies: ['a'] },
  { taskKey: 'c', status: 'failed', dependencies: ['b'] },
  { taskKey: 'd', status: 'pending', dependencies: ['c'] },
];

test('computeResumePlan: no plan is ineligible', () => {
  const r = computeResumePlan({ planExists: false, tasks, mode: { kind: 'auto' } });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'no_plan');
});

test('computeResumePlan: auto resets failed/cancelled, keeps done', () => {
  const r = computeResumePlan({ planExists: true, tasks, mode: { kind: 'auto' } });
  assert.equal(r.eligible, true);
  assert.deepEqual(r.resetKeys.sort(), ['c']);
  assert.equal(r.doneCount, 2);
});

test('computeResumePlan: auto with cancelled tasks', () => {
  const cancelledTasks = [
    { taskKey: 'a', status: 'done', dependencies: [] },
    { taskKey: 'b', status: 'cancelled', dependencies: ['a'] },
    { taskKey: 'c', status: 'cancelled', dependencies: ['b'] },
  ];
  const r = computeResumePlan({ planExists: true, tasks: cancelledTasks, mode: { kind: 'auto' } });
  assert.equal(r.eligible, true);
  assert.deepEqual(r.resetKeys.sort(), ['b', 'c']);
});

test('computeResumePlan: all done returns no_resumable_tasks', () => {
  const allDone = [
    { taskKey: 'a', status: 'done', dependencies: [] },
    { taskKey: 'b', status: 'done', dependencies: ['a'] },
  ];
  const r = computeResumePlan({ planExists: true, tasks: allDone, mode: { kind: 'auto' } });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'no_resumable_tasks');
});

test('computeResumePlan: no done tasks returns no_reusable_done_tasks', () => {
  const noDone = [
    { taskKey: 'a', status: 'failed', dependencies: [] },
    { taskKey: 'b', status: 'pending', dependencies: ['a'] },
  ];
  const r = computeResumePlan({ planExists: true, tasks: noDone, mode: { kind: 'auto' } });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'no_reusable_done_tasks');
});

test('computeResumePlan: fromTask target failed is eligible', () => {
  const r = computeResumePlan({
    planExists: true,
    tasks,
    mode: { kind: 'fromTask', targetKey: 'c' },
  });
  assert.equal(r.eligible, true);
  assert.deepEqual(r.resetKeys.sort(), ['c']);
});

test('computeResumePlan: fromTask target done returns task_not_retryable', () => {
  const r = computeResumePlan({
    planExists: true,
    tasks,
    mode: { kind: 'fromTask', targetKey: 'a' },
  });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'task_not_retryable');
});

test('computeResumePlan: fromTask target missing returns target_not_found', () => {
  const r = computeResumePlan({
    planExists: true,
    tasks,
    mode: { kind: 'fromTask', targetKey: 'zzz' },
  });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'target_not_found');
});

// --- Phase 9: rerunFromTask -------------------------------------------------

const diamond = [
  { taskKey: 'root', status: 'done', dependencies: [] },
  { taskKey: 'left', status: 'done', dependencies: ['root'] },
  { taskKey: 'right', status: 'done', dependencies: ['root'] },
  { taskKey: 'merge', status: 'done', dependencies: ['left', 'right'] },
];

test('rerunFromTask: done target resets target + transitive downstream, reuses upstream', () => {
  const r = computeResumePlan({
    planExists: true,
    tasks: diamond,
    mode: { kind: 'rerunFromTask', targetKey: 'left' },
  });
  assert.equal(r.eligible, true);
  assert.deepEqual(r.resetKeys.sort(), ['left', 'merge']);
  assert.equal(r.doneCount, 2); // root + right reused
});

test('rerunFromTask: root resets the whole graph', () => {
  const r = computeResumePlan({
    planExists: true,
    tasks: diamond,
    mode: { kind: 'rerunFromTask', targetKey: 'root' },
  });
  assert.equal(r.eligible, true);
  assert.deepEqual(r.resetKeys.sort(), ['left', 'merge', 'right', 'root']);
  assert.equal(r.doneCount, 0);
});

test('rerunFromTask: leaf target resets only itself', () => {
  const r = computeResumePlan({
    planExists: true,
    tasks: diamond,
    mode: { kind: 'rerunFromTask', targetKey: 'merge' },
  });
  assert.equal(r.eligible, true);
  assert.deepEqual(r.resetKeys.sort(), ['merge']);
  assert.equal(r.doneCount, 3);
});

test('rerunFromTask: union includes existing failed/cancelled for completeness', () => {
  const mixed = [
    { taskKey: 'x', status: 'done', dependencies: [] },
    { taskKey: 'y', status: 'failed', dependencies: [] }, // independent failure
  ];
  const r = computeResumePlan({
    planExists: true,
    tasks: mixed,
    mode: { kind: 'rerunFromTask', targetKey: 'x' },
  });
  assert.equal(r.eligible, true);
  assert.deepEqual(r.resetKeys.sort(), ['x', 'y']);
});

test('rerunFromTask: pending target returns task_not_rerunnable', () => {
  const r = computeResumePlan({
    planExists: true,
    tasks,
    mode: { kind: 'rerunFromTask', targetKey: 'd' },
  });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'task_not_rerunnable');
});

test('rerunFromTask: missing target returns target_not_found', () => {
  const r = computeResumePlan({
    planExists: true,
    tasks: diamond,
    mode: { kind: 'rerunFromTask', targetKey: 'zzz' },
  });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'target_not_found');
});
