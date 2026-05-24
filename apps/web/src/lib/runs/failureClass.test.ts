import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyFailure } from './failureClass';

test('classifyFailure: null/empty → none', () => {
  assert.equal(classifyFailure(null).recoveryAction, 'none');
  assert.equal(classifyFailure('').category, 'none');
});

test('classifyFailure: provider/lead-plan model failures → edit-models', () => {
  const cases = [
    'lead_plan_provider_unavailable:anthropic',
    'lead_plan_provider_auth:openai',
    'lead_plan_unknown_provider:foo',
    'lead_plan_schema_error',
    'lead_plan_timeout:120000ms',
  ];
  for (const reason of cases) {
    assert.equal(classifyFailure(reason).recoveryAction, 'edit-models', reason);
  }
});

test('classifyFailure: aborted/plan/task/restart → retry', () => {
  const cases = [
    'lead_plan_aborted',
    'lead_plan_invalid:bad dag',
    'lead_plan_failed:boom',
    'task_failed:t3',
    'process_restart',
  ];
  for (const reason of cases) {
    assert.equal(classifyFailure(reason).recoveryAction, 'retry', reason);
  }
});

test('classifyFailure: categories map precisely', () => {
  assert.equal(classifyFailure('lead_plan_timeout:5ms').category, 'timeout');
  assert.equal(classifyFailure('task_failed:t1').category, 'task_failed');
  assert.equal(classifyFailure('process_restart').category, 'process_restart');
  assert.equal(classifyFailure('something_else').category, 'unknown');
});

test('classifyFailure: unknown reason still retryable with copy', () => {
  const c = classifyFailure('weird_reason');
  assert.equal(c.recoveryAction, 'retry');
  assert.ok(c.title.length > 0);
  assert.ok(c.help.length > 0);
});
