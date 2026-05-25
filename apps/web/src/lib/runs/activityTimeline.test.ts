import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildActivityTimeline, type ActivityEvent } from './activityTimeline';

const ctx = {
  tasks: [{ taskKey: 'worker', name: 'Build worker', agentId: 'a1' }],
  agents: [{ id: 'a1', name: 'Worker Agent' }],
};

function ev(type: string, payload: unknown, extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return { id: type + '-1', type, payload, createdAt: '2026-05-25T00:00:00.000Z', ...extra };
}

test('buildActivityTimeline: empty input → []', () => {
  assert.deepEqual(buildActivityTimeline([]), []);
});

test('buildActivityTimeline: agent.output.delta is NEVER included', () => {
  const out = buildActivityTimeline([ev('agent.output.delta', { taskKey: 'worker', text: 'x' })], ctx);
  assert.deepEqual(out, []);
});

test('buildActivityTimeline: excludes agent.output.completed, revision.*, feedback.*', () => {
  const out = buildActivityTimeline(
    [
      ev('agent.output.completed', { taskKey: 'worker', bytes: 10 }),
      ev('revision.proposed', {}),
      ev('feedback.submitted', {}),
    ],
    ctx,
  );
  assert.deepEqual(out, []);
});

test('buildActivityTimeline: task.completed → success with duration + resolved task name', () => {
  const [item] = buildActivityTimeline([ev('task.completed', { taskKey: 'worker', durationMs: 1500 })], ctx);
  assert.equal(item?.level, 'success');
  assert.equal(item?.label, 'Task Build worker completed');
  assert.equal(item?.detail, '1.5s');
});

test('buildActivityTimeline: task.failed → error with error + duration', () => {
  const [item] = buildActivityTimeline([ev('task.failed', { taskKey: 'worker', error: 'boom', durationMs: 800 })], ctx);
  assert.equal(item?.level, 'error');
  assert.equal(item?.label, 'Task Build worker failed');
  assert.equal(item?.detail, 'boom · 800ms');
});

test('buildActivityTimeline: task.retry.attempt → warn', () => {
  const [item] = buildActivityTimeline([ev('task.retry.attempt', { taskKey: 'worker', attempt: 2, kind: 'rate_limit', delayMs: 2000 })], ctx);
  assert.equal(item?.level, 'warn');
  assert.equal(item?.label, 'Task Build worker retry #2');
  assert.equal(item?.detail, 'rate_limit · 2.0s backoff');
});

test('buildActivityTimeline: run.resumed → warn with mode/trigger/counts', () => {
  const [item] = buildActivityTimeline([ev('run.resumed', { mode: 'auto', trigger: 'process_restart', resumedTasks: 1, doneReused: 2 })]);
  assert.equal(item?.level, 'warn');
  assert.equal(item?.label, 'Run resumed (auto, process_restart)');
  assert.equal(item?.detail, '1 re-run · 2 reused');
});

test('buildActivityTimeline: run.completed success vs failure', () => {
  const [ok] = buildActivityTimeline([ev('run.completed', { success: true })]);
  assert.equal(ok?.level, 'success');
  assert.equal(ok?.label, 'Run completed');
  const [bad] = buildActivityTimeline([ev('run.completed', { success: false, failedReason: 'process_restart' })]);
  assert.equal(bad?.level, 'error');
  assert.equal(bad?.label, 'Run failed');
  assert.equal(bad?.detail, 'process_restart');
});

test('buildActivityTimeline: run.cancelled → error, run.autoresume.failed → error', () => {
  const [c] = buildActivityTimeline([ev('run.cancelled', { failedReason: 'user_cancelled', cancelledTasks: 3 })]);
  assert.equal(c?.level, 'error');
  assert.equal(c?.detail, '3 tasks cancelled');
  const [a] = buildActivityTimeline([ev('run.autoresume.failed', { reason: 'no_resumable_tasks' })]);
  assert.equal(a?.level, 'error');
  assert.equal(a?.detail, 'no_resumable_tasks');
});

test('buildActivityTimeline: task name falls back to taskKey when not in ctx', () => {
  const [item] = buildActivityTimeline([ev('task.started', { taskKey: 'unknown-key', agentName: 'Inline Agent' })]);
  assert.equal(item?.label, 'Task unknown-key started');
  assert.equal(item?.detail, 'Agent Inline Agent');
});

test('buildActivityTimeline: agent name resolved from agentId when payload lacks agentName', () => {
  const [item] = buildActivityTimeline([ev('task.started', { taskKey: 'worker' }, { agentId: 'a1' })], ctx);
  assert.equal(item?.detail, 'Agent Worker Agent');
});

test('buildActivityTimeline: missing/empty payload does not crash (partial detail)', () => {
  const [item] = buildActivityTimeline([ev('task.completed', undefined, { id: 'x' })], ctx);
  assert.equal(item?.level, 'success');
  assert.equal(item?.label, 'Task task completed');
  assert.equal(item?.detail, undefined);
});

test('buildActivityTimeline: unknown event type → neutral, label = type', () => {
  const [item] = buildActivityTimeline([ev('some.future.event', { x: 1 })]);
  assert.equal(item?.level, 'neutral');
  assert.equal(item?.label, 'some.future.event');
});

test('buildActivityTimeline: run.running recognized as info (future-proof, not excluded)', () => {
  const [item] = buildActivityTimeline([ev('run.running', {})]);
  assert.equal(item?.level, 'info');
  assert.equal(item?.label, 'Run running');
});

test('buildActivityTimeline: dedupes repeated event ids (keeps first)', () => {
  const dup = ev('task.completed', { taskKey: 'worker', durationMs: 100 }, { id: 'dup1' });
  const out = buildActivityTimeline([dup, dup], ctx);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'dup1');
});

test('buildActivityTimeline: preserves input order and carries id/at/type', () => {
  const out = buildActivityTimeline([
    ev('run.started', { teamId: 't' }, { id: 'e1', createdAt: '2026-05-25T00:00:01.000Z' }),
    ev('plan.created', { taskCount: 4 }, { id: 'e2', createdAt: '2026-05-25T00:00:02.000Z' }),
  ]);
  assert.deepEqual(out.map((i) => i.id), ['e1', 'e2']);
  assert.equal(out[1]?.label, 'Execution plan created');
  assert.equal(out[1]?.detail, '4 tasks');
  assert.equal(out[0]?.at, '2026-05-25T00:00:01.000Z');
});
