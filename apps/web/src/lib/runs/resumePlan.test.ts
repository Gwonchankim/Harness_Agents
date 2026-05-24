import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeResumePlan } from './resumePlan';

const tasks = [
  { taskKey: 'a', status: 'done' },
  { taskKey: 'b', status: 'done' },
  { taskKey: 'c', status: 'failed' },
  { taskKey: 'd', status: 'pending' },
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
    { taskKey: 'a', status: 'done' },
    { taskKey: 'b', status: 'cancelled' },
    { taskKey: 'c', status: 'cancelled' },
  ];
  const r = computeResumePlan({ planExists: true, tasks: cancelledTasks, mode: { kind: 'auto' } });
  assert.equal(r.eligible, true);
  assert.deepEqual(r.resetKeys.sort(), ['b', 'c']);
});

test('computeResumePlan: all done returns no_resumable_tasks', () => {
  const allDone = [
    { taskKey: 'a', status: 'done' },
    { taskKey: 'b', status: 'done' },
  ];
  const r = computeResumePlan({ planExists: true, tasks: allDone, mode: { kind: 'auto' } });
  assert.equal(r.eligible, false);
  assert.equal(r.reason, 'no_resumable_tasks');
});

test('computeResumePlan: no done tasks returns no_reusable_done_tasks', () => {
  const noDone = [
    { taskKey: 'a', status: 'failed' },
    { taskKey: 'b', status: 'pending' },
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
