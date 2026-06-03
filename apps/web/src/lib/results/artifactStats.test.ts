import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countVersionsByGroup, summarizeRedundancy } from './artifactStats';
import type { ArtifactRow } from './artifactList';

function row(
  id: string,
  kind: string,
  path: string,
  sha256: string | null = null,
  createdAt = '2026-06-01T00:00:00.000Z',
): ArtifactRow {
  return { id, kind, path, bytes: 0, sha256, createdAt, taskId: null };
}

// --- countVersionsByGroup ---

test('countVersionsByGroup: empty → empty map', () => {
  assert.equal(countVersionsByGroup([]).size, 0);
});

test('countVersionsByGroup: single group single version', () => {
  const m = countVersionsByGroup([row('1', 'result_md', 'p/result.md', 'sha1')]);
  assert.deepEqual(m.get('result_md p/result.md'), {
    versionCount: 1,
    redundantCount: 0,
    changedVersionCount: 1,
    sameContentCount: 0,
  });
});

test('countVersionsByGroup: multi-version, same content (same sha)', () => {
  const m = countVersionsByGroup([
    row('1', 'report_md', 'p/report.md', 'sha1'),
    row('2', 'report_md', 'p/report.md', 'sha1'),
    row('3', 'report_md', 'p/report.md', 'sha1'),
  ]);
  assert.deepEqual(m.get('report_md p/report.md'), {
    versionCount: 3,
    redundantCount: 2,
    changedVersionCount: 1, // one distinct content
    sameContentCount: 2, // two byte-identical extras
  });
});

test('countVersionsByGroup: multi-version, changed content (mixed sha)', () => {
  const m = countVersionsByGroup([
    row('1', 'result_md', 'p/result.md', 'sha1'),
    row('2', 'result_md', 'p/result.md', 'sha1'),
    row('3', 'result_md', 'p/result.md', 'sha2'),
  ]);
  assert.deepEqual(m.get('result_md p/result.md'), {
    versionCount: 3,
    redundantCount: 2,
    changedVersionCount: 2, // sha1, sha2
    sameContentCount: 1, // one extra sha1
  });
});

test('countVersionsByGroup: all-distinct sha → sameContentCount 0', () => {
  const m = countVersionsByGroup([
    row('1', 'result_md', 'p/result.md', 'sha1'),
    row('2', 'result_md', 'p/result.md', 'sha2'),
    row('3', 'result_md', 'p/result.md', 'sha3'),
  ]);
  assert.deepEqual(m.get('result_md p/result.md'), {
    versionCount: 3,
    redundantCount: 2,
    changedVersionCount: 3, // all genuinely different
    sameContentCount: 0, // no byte-identical extras
  });
});

test('countVersionsByGroup: null sha256 only → no sha breakdown', () => {
  const m = countVersionsByGroup([
    row('1', 'team_md', 'p/AGENTS.md', null),
    row('2', 'team_md', 'p/AGENTS.md', null),
  ]);
  assert.deepEqual(m.get('team_md p/AGENTS.md'), {
    versionCount: 2,
    redundantCount: 1,
  });
});

test('countVersionsByGroup: mixed null + non-null sha (nulls excluded from breakdown)', () => {
  const m = countVersionsByGroup([
    row('1', 'team_json', 'p/team.json', 'sha1'),
    row('2', 'team_json', 'p/team.json', null),
    row('3', 'team_json', 'p/team.json', 'sha1'),
  ]);
  assert.deepEqual(m.get('team_json p/team.json'), {
    versionCount: 3,
    redundantCount: 2,
    changedVersionCount: 1, // one distinct non-null sha
    sameContentCount: 1, // two non-null rows, one extra
  });
});

test('countVersionsByGroup: multiple groups keyed independently', () => {
  const m = countVersionsByGroup([
    row('1', 'result_md', 'p/result.md', 'a'),
    row('2', 'result_md', 'p/result.md', 'a'),
    row('3', 'report_md', 'p/report.md', 'b'),
  ]);
  assert.equal(m.size, 2);
  assert.equal(m.get('result_md p/result.md')?.versionCount, 2);
  assert.equal(m.get('report_md p/report.md')?.versionCount, 1);
});

test('countVersionsByGroup: does not mutate input', () => {
  const rows = [row('1', 'result_md', 'p/result.md', 'a'), row('2', 'result_md', 'p/result.md', 'a')];
  const copy = rows.map((r) => ({ ...r }));
  countVersionsByGroup(rows);
  assert.deepEqual(rows, copy);
});

// --- summarizeRedundancy ---

test('summarizeRedundancy: empty → zeros', () => {
  assert.deepEqual(summarizeRedundancy([]), {
    groups: 0,
    totalVersions: 0,
    redundant: 0,
    redundancyPct: 0,
    byKind: {},
  });
});

test('summarizeRedundancy: single group single version → no redundancy', () => {
  assert.deepEqual(summarizeRedundancy([{ kind: 'result_md', versionCount: 1 }]), {
    groups: 1,
    totalVersions: 1,
    redundant: 0,
    redundancyPct: 0,
    byKind: { result_md: { groups: 1, versions: 1, redundant: 0 } },
  });
});

test('summarizeRedundancy: missing versionCount treated as 1', () => {
  const s = summarizeRedundancy([{ kind: 'team_md' }]);
  assert.equal(s.totalVersions, 1);
  assert.equal(s.redundant, 0);
});

test('summarizeRedundancy: multiple groups, byKind aggregation', () => {
  const s = summarizeRedundancy([
    { kind: 'result_md', versionCount: 3 },
    { kind: 'report_md', versionCount: 1 },
    { kind: 'agent_report_md', versionCount: 2 },
  ]);
  assert.equal(s.groups, 3);
  assert.equal(s.totalVersions, 6);
  assert.equal(s.redundant, 3); // 2 + 0 + 1
  assert.equal(s.redundancyPct, 50);
  assert.deepEqual(s.byKind, {
    result_md: { groups: 1, versions: 3, redundant: 2 },
    report_md: { groups: 1, versions: 1, redundant: 0 },
    agent_report_md: { groups: 1, versions: 2, redundant: 1 },
  });
});

test('summarizeRedundancy: same kind multiple paths aggregated by kind', () => {
  const s = summarizeRedundancy([
    { kind: 'agent_report_md', versionCount: 2 },
    { kind: 'agent_report_md', versionCount: 3 },
  ]);
  assert.deepEqual(s.byKind.agent_report_md, { groups: 2, versions: 5, redundant: 3 });
});

test('summarizeRedundancy: redundancyPct rounds to 1 decimal', () => {
  // redundant 5 / total 7 = 71.428... → 71.4
  const s = summarizeRedundancy([
    { kind: 'result_md', versionCount: 3 },
    { kind: 'report_md', versionCount: 4 },
  ]);
  assert.equal(s.redundant, 5);
  assert.equal(s.totalVersions, 7);
  assert.equal(s.redundancyPct, 71.4);
});

test('summarizeRedundancy: does not mutate input', () => {
  const metas = [{ kind: 'result_md', versionCount: 2 }];
  const copy = metas.map((m) => ({ ...m }));
  summarizeRedundancy(metas);
  assert.deepEqual(metas, copy);
});
