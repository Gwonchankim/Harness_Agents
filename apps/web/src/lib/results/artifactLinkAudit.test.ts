import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  selectCleanupCandidates,
  buildLinkAudit,
  type CleanupCandidateGroup,
} from './artifactLinkAudit';
import type { ArtifactRow } from './artifactList';

function row(
  id: string,
  kind: string,
  path: string,
  createdAt: string,
  sha256: string | null = null,
): ArtifactRow {
  return { id, kind, path, bytes: 0, sha256, createdAt, taskId: null };
}

// --- selectCleanupCandidates ---

test('selectCleanupCandidates: empty → no groups, no candidates', () => {
  assert.deepEqual(selectCleanupCandidates([]), { groups: [], allCandidateIds: [] });
});

test('selectCleanupCandidates: single version → latest only, no candidates', () => {
  const res = selectCleanupCandidates([row('1', 'result_md', 'p/result.md', '2026-06-01T00:00:01.000Z')]);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0]?.latestId, '1');
  assert.deepEqual(res.groups[0]?.candidateIds, []);
  assert.deepEqual(res.allCandidateIds, []);
});

test('selectCleanupCandidates: multi-version → latest kept, older are candidates (newest-first)', () => {
  const res = selectCleanupCandidates([
    row('1', 'result_md', 'p/result.md', '2026-06-01T00:00:01.000Z'),
    row('2', 'result_md', 'p/result.md', '2026-06-01T00:00:02.000Z'),
    row('3', 'result_md', 'p/result.md', '2026-06-01T00:00:03.000Z'),
  ]);
  assert.equal(res.groups.length, 1);
  assert.equal(res.groups[0]?.latestId, '3');
  assert.deepEqual(res.groups[0]?.candidateIds, ['2', '1']); // newest-first, latest (3) excluded
  assert.deepEqual(res.allCandidateIds, ['2', '1']);
});

test('selectCleanupCandidates: multiple groups keyed by (kind, path)', () => {
  const res = selectCleanupCandidates([
    row('a1', 'result_md', 'p/result.md', '2026-06-01T00:00:01.000Z'),
    row('a2', 'result_md', 'p/result.md', '2026-06-01T00:00:02.000Z'),
    row('b1', 'report_md', 'p/report.md', '2026-06-01T00:00:01.000Z'),
  ]);
  assert.equal(res.groups.length, 2);
  const result = res.groups.find((x) => x.kind === 'result_md');
  const report = res.groups.find((x) => x.kind === 'report_md');
  assert.deepEqual(result?.candidateIds, ['a1']);
  assert.deepEqual(report?.candidateIds, []);
  assert.deepEqual(res.allCandidateIds, ['a1']);
});

test('selectCleanupCandidates: same path different kind are distinct groups', () => {
  const res = selectCleanupCandidates([
    row('x', 'team_md', 'p/shared', '2026-06-01T00:00:01.000Z'),
    row('y', 'team_json', 'p/shared', '2026-06-01T00:00:01.000Z'),
  ]);
  assert.equal(res.groups.length, 2);
});

test('selectCleanupCandidates: does not mutate input', () => {
  const rows = [
    row('1', 'result_md', 'p/result.md', '2026-06-01T00:00:01.000Z'),
    row('2', 'result_md', 'p/result.md', '2026-06-01T00:00:02.000Z'),
  ];
  const copy = rows.map((r) => ({ ...r }));
  selectCleanupCandidates(rows);
  assert.deepEqual(rows, copy);
});

// --- buildLinkAudit ---

function g(kind: string, path: string, latestId: string, candidateIds: string[]): CleanupCandidateGroup {
  return { kind, path, latestId, candidateIds };
}

test('buildLinkAudit: empty groups → zeros', () => {
  assert.deepEqual(buildLinkAudit([], new Map()), {
    summary: { totalGroups: 0, cleanupCandidateRows: 0, affectedGroups: 0, fullAuditLinkedEvents: 0 },
    groups: [],
  });
});

test('buildLinkAudit: single-version group (no candidates) → no links, not affected', () => {
  const audit = buildLinkAudit([g('result_md', 'p/result.md', '1', [])], new Map());
  assert.equal(audit.summary.totalGroups, 1);
  assert.equal(audit.summary.cleanupCandidateRows, 0);
  assert.equal(audit.summary.affectedGroups, 0);
  assert.equal(audit.summary.fullAuditLinkedEvents, 0);
  assert.equal(audit.groups[0]?.candidateCount, 0);
  assert.equal(audit.groups[0]?.linkedEventsAffected, 0);
});

test('buildLinkAudit: linked OLD artifact → counted', () => {
  const audit = buildLinkAudit(
    [g('result_md', 'p/result.md', '3', ['2', '1'])],
    new Map([['2', 1], ['1', 1]]),
  );
  assert.equal(audit.groups[0]?.candidateCount, 2);
  assert.equal(audit.groups[0]?.linkedEventsAffected, 2);
  assert.equal(audit.summary.affectedGroups, 1);
  assert.equal(audit.summary.fullAuditLinkedEvents, 2);
});

test('buildLinkAudit: candidate referenced by multiple events (count>1) is summed', () => {
  const audit = buildLinkAudit(
    [g('result_md', 'p/result.md', '3', ['2', '1'])],
    new Map([['2', 3], ['1', 1]]),
  );
  assert.equal(audit.groups[0]?.linkedEventsAffected, 4); // 3 + 1
  assert.equal(audit.summary.fullAuditLinkedEvents, 4);
});

test('buildLinkAudit: link only on latest id (not a candidate) → 0 affected', () => {
  const audit = buildLinkAudit(
    [g('result_md', 'p/result.md', '3', ['2', '1'])],
    new Map([['3', 1]]), // latest id '3' is not in candidateIds
  );
  assert.equal(audit.groups[0]?.linkedEventsAffected, 0);
  assert.equal(audit.summary.fullAuditLinkedEvents, 0);
});

test('buildLinkAudit: non-result kind with empty/absent map entries → 0 linked', () => {
  const audit = buildLinkAudit([g('report_md', 'p/report.md', '2', ['1'])], new Map());
  assert.equal(audit.groups[0]?.candidateCount, 1);
  assert.equal(audit.groups[0]?.linkedEventsAffected, 0);
  assert.equal(audit.summary.cleanupCandidateRows, 1);
  assert.equal(audit.summary.affectedGroups, 1);
  assert.equal(audit.summary.fullAuditLinkedEvents, 0);
});

test('buildLinkAudit: multiple groups aggregate totals', () => {
  const audit = buildLinkAudit(
    [
      g('result_md', 'p/result.md', 'r3', ['r2', 'r1']),
      g('report_md', 'p/report.md', 'p1', []),
      g('agent_report_md', 'p/a.md', 'a2', ['a1']),
    ],
    new Map([['r2', 1], ['a1', 1]]),
  );
  assert.equal(audit.summary.totalGroups, 3);
  assert.equal(audit.summary.cleanupCandidateRows, 3); // 2 + 0 + 1
  assert.equal(audit.summary.affectedGroups, 2);
  assert.equal(audit.summary.fullAuditLinkedEvents, 2); // r2 + a1
});

test('buildLinkAudit: group output carries candidateIds (internal/Phase 21 reuse)', () => {
  const audit = buildLinkAudit([g('result_md', 'p/result.md', '3', ['2', '1'])], new Map());
  assert.deepEqual(audit.groups[0]?.candidateIds, ['2', '1']);
});

test('buildLinkAudit: does not mutate inputs', () => {
  const groups = [g('result_md', 'p/result.md', '3', ['2', '1'])];
  const map = new Map([['2', 1]]);
  const gCopy = groups.map((x) => ({ ...x, candidateIds: [...x.candidateIds] }));
  const mCopy = new Map(map);
  buildLinkAudit(groups, map);
  assert.deepEqual(groups, gCopy);
  assert.deepEqual(map, mCopy);
});
