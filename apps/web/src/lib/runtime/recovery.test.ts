import assert from 'node:assert/strict';
import { test } from 'node:test';

import { shouldAutoResume, type AutoResumeCandidate } from './recovery';

const eligible: AutoResumeCandidate = {
  failedReason: 'process_restart',
  hasPlan: true,
  doneCount: 1,
  nonDoneCount: 1,
};

test('shouldAutoResume: all four criteria met → true', () => {
  assert.equal(shouldAutoResume(eligible, { autoResume: true }), true);
});

test('shouldAutoResume: opt-out (autoResume off) → false', () => {
  assert.equal(shouldAutoResume(eligible, { autoResume: false }), false);
});

test('shouldAutoResume: non process_restart failure → false', () => {
  assert.equal(
    shouldAutoResume({ ...eligible, failedReason: 'user_cancelled' }, { autoResume: true }),
    false,
  );
  assert.equal(shouldAutoResume({ ...eligible, failedReason: null }, { autoResume: true }), false);
});

test('shouldAutoResume: no execution plan → false', () => {
  assert.equal(shouldAutoResume({ ...eligible, hasPlan: false }, { autoResume: true }), false);
});

test('shouldAutoResume: no done task to reuse → false', () => {
  assert.equal(shouldAutoResume({ ...eligible, doneCount: 0 }, { autoResume: true }), false);
});

test('shouldAutoResume: no remaining work → false', () => {
  assert.equal(shouldAutoResume({ ...eligible, nonDoneCount: 0 }, { autoResume: true }), false);
});
