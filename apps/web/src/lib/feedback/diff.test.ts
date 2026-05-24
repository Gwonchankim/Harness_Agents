import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countDiff, diffLines, summarizeTeamChanges, type DiffTeamSpec } from './diff';

test('diffLines: identical input is all context', () => {
  const d = diffLines('a\nb\nc', 'a\nb\nc');
  assert.deepEqual(
    d.map((l) => l.type),
    ['ctx', 'ctx', 'ctx'],
  );
});

test('diffLines: pure insertion', () => {
  const d = diffLines('a\nb', 'a\nx\nb');
  assert.deepEqual(d, [
    { type: 'ctx', text: 'a' },
    { type: 'add', text: 'x' },
    { type: 'ctx', text: 'b' },
  ]);
});

test('diffLines: pure deletion', () => {
  const d = diffLines('a\nx\nb', 'a\nb');
  assert.deepEqual(d, [
    { type: 'ctx', text: 'a' },
    { type: 'del', text: 'x' },
    { type: 'ctx', text: 'b' },
  ]);
});

test('countDiff: replaced line counts as one add + one del', () => {
  const c = countDiff(diffLines('a\nb\nc', 'a\nB\nc'));
  assert.equal(c.added, 1);
  assert.equal(c.removed, 1);
});

test('summarizeTeamChanges: role + lead change, no add/remove', () => {
  const before: DiffTeamSpec = {
    name: 'T',
    description: null,
    agents: [
      { agentId: 'a1', name: 'A', isLead: true, role: 'r1', systemPrompt: 'p', toolsAllowed: [], tags: [] },
      { agentId: 'a2', name: 'B', isLead: false, role: 'r2', systemPrompt: 'p', toolsAllowed: [], tags: [] },
    ],
  };
  const after: DiffTeamSpec = {
    name: 'T',
    description: null,
    agents: [
      { agentId: 'a1', name: 'A', isLead: false, role: 'r1-new', systemPrompt: 'p', toolsAllowed: [], tags: [] },
      { agentId: 'a2', name: 'B', isLead: true, role: 'r2', systemPrompt: 'p', toolsAllowed: [], tags: [] },
    ],
  };
  const s = summarizeTeamChanges(before, after);
  assert.equal(s.leadChanged, true);
  assert.equal(s.addedAgents.length, 0);
  assert.equal(s.removedAgents.length, 0);
  const a1 = s.changedAgents.find((c) => c.agentId === 'a1');
  assert.ok(a1);
  assert.ok(a1!.fields.includes('role'));
  assert.ok(a1!.fields.includes('isLead'));
});
