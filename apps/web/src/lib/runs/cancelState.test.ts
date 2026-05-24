import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  canCancel,
  cancelTransition,
  CANCELLABLE_TASK_STATUSES,
  CANCELLED_RUN_REASON,
} from './cancelState';

test('canCancel: only planning/running are cancellable', () => {
  assert.equal(canCancel('planning'), true);
  assert.equal(canCancel('running'), true);
  assert.equal(canCancel('ready'), false);
  assert.equal(canCancel('succeeded'), false);
  assert.equal(canCancel('failed'), false);
  assert.equal(canCancel('pending'), false);
  assert.equal(canCancel(null), false);
  assert.equal(canCancel(undefined), false);
});

test('cancelTransition: failed + user_cancelled, running/pending tasks cancelled', () => {
  const t = cancelTransition();
  assert.equal(t.runStatus, 'failed');
  assert.equal(t.failedReason, 'user_cancelled');
  assert.equal(t.failedReason, CANCELLED_RUN_REASON);
  assert.equal(t.taskStatus, 'cancelled');
  assert.deepEqual([...t.taskStatusesToCancel], ['pending', 'running']);
  assert.deepEqual([...t.taskStatusesToCancel], [...CANCELLABLE_TASK_STATUSES]);
});
