import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resumeTarget } from './resumeTarget';

test('resumeTarget: po_qa with no session → intake', () => {
  const r = resumeTarget({ id: 'r1', status: 'po_qa', qaSession: null });
  assert.equal(r.stage, 'intake');
  assert.equal(r.href, '/runs/new');
});

test('resumeTarget: pending with active session → qa', () => {
  const r = resumeTarget({ id: 'r1', status: 'pending', qaSession: { id: 's1', status: 'active' } });
  assert.equal(r.stage, 'qa');
  assert.equal(r.href, '/runs/new/s1');
});

test('resumeTarget: completed session → compose', () => {
  const r = resumeTarget({ id: 'r1', status: 'po_qa', qaSession: { id: 's1', status: 'completed' } });
  assert.equal(r.stage, 'compose');
  assert.equal(r.href, '/runs/new/s1/compose');
});

test('resumeTarget: lifecycle statuses point at run detail', () => {
  for (const status of ['ready', 'planning', 'running', 'succeeded', 'failed'] as const) {
    const r = resumeTarget({ id: 'rX', status, qaSession: null });
    assert.equal(r.href, '/runs/rX');
    assert.equal(r.stage, status);
  }
});

test('resumeTarget: unknown status falls back to other', () => {
  const r = resumeTarget({ id: 'rX', status: 'weird', qaSession: null });
  assert.equal(r.stage, 'other');
  assert.equal(r.label, 'weird');
  assert.equal(r.href, '/runs/rX');
});
