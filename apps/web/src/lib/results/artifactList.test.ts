import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupArtifactHistory, selectLatestArtifacts, type ArtifactRow } from './artifactList';

function a(id: string, kind: string, path: string, createdAt: string): ArtifactRow {
  return { id, kind, path, bytes: 0, sha256: null, createdAt, taskId: null };
}

test('selectLatestArtifacts: empty → []', () => {
  assert.deepEqual(selectLatestArtifacts([]), []);
});

test('selectLatestArtifacts: dedupes same (kind,path) to the latest createdAt', () => {
  const rows = [
    a('1', 'report_md', 'p/report.md', '2026-05-25T00:00:01.000Z'),
    a('2', 'report_md', 'p/report.md', '2026-05-25T00:00:03.000Z'),
    a('3', 'report_md', 'p/report.md', '2026-05-25T00:00:02.000Z'),
  ];
  const out = selectLatestArtifacts(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, '2');
});

test('selectLatestArtifacts: createdAt tie → higher id wins', () => {
  const rows = [
    a('aaa', 'report_md', 'p/report.md', '2026-05-25T00:00:00.000Z'),
    a('bbb', 'report_md', 'p/report.md', '2026-05-25T00:00:00.000Z'),
  ];
  const out = selectLatestArtifacts(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.id, 'bbb');
});

test('selectLatestArtifacts: keeps distinct kinds and orders result→report→agent', () => {
  const rows = [
    a('r', 'report_md', 'p/report.md', '2026-05-25T00:00:00.000Z'),
    a('g', 'agent_report_md', 'p/agent-reports/a1.md', '2026-05-25T00:00:00.000Z'),
    a('d', 'result_md', 'p/result.md', '2026-05-25T00:00:00.000Z'),
  ];
  const out = selectLatestArtifacts(rows);
  assert.deepEqual(out.map((x) => x.kind), ['result_md', 'report_md', 'agent_report_md']);
});

test('selectLatestArtifacts: multiple agent-report paths preserved, sorted by path', () => {
  const rows = [
    a('g2', 'agent_report_md', 'p/agent-reports/b.md', '2026-05-25T00:00:00.000Z'),
    a('g1', 'agent_report_md', 'p/agent-reports/a.md', '2026-05-25T00:00:00.000Z'),
    a('g1b', 'agent_report_md', 'p/agent-reports/a.md', '2026-05-25T00:00:09.000Z'),
  ];
  const out = selectLatestArtifacts(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((x) => x.path), ['p/agent-reports/a.md', 'p/agent-reports/b.md']);
  assert.equal(out[0]?.id, 'g1b'); // latest for a.md
});

test('groupArtifactHistory: empty → []', () => {
  assert.deepEqual(groupArtifactHistory([]), []);
});

test('groupArtifactHistory: single (kind,path) keeps all versions newest-first', () => {
  const rows = [
    a('1', 'report_md', 'p/report.md', '2026-05-25T00:00:01.000Z'),
    a('2', 'report_md', 'p/report.md', '2026-05-25T00:00:03.000Z'),
    a('3', 'report_md', 'p/report.md', '2026-05-25T00:00:02.000Z'),
  ];
  const out = groupArtifactHistory(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.latest.id, '2');
  assert.deepEqual(out[0]?.versions.map((v) => v.id), ['2', '3', '1']);
});

test('groupArtifactHistory: createdAt tie → higher id is newer', () => {
  const rows = [
    a('aaa', 'report_md', 'p/report.md', '2026-05-25T00:00:00.000Z'),
    a('bbb', 'report_md', 'p/report.md', '2026-05-25T00:00:00.000Z'),
  ];
  const out = groupArtifactHistory(rows);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.latest.id, 'bbb');
  assert.deepEqual(out[0]?.versions.map((v) => v.id), ['bbb', 'aaa']);
});

test('groupArtifactHistory: separates (kind,path) and orders result→report→agent', () => {
  const rows = [
    a('r', 'report_md', 'p/report.md', '2026-05-25T00:00:00.000Z'),
    a('g', 'agent_report_md', 'p/agent-reports/a1.md', '2026-05-25T00:00:00.000Z'),
    a('d', 'result_md', 'p/result.md', '2026-05-25T00:00:00.000Z'),
  ];
  const out = groupArtifactHistory(rows);
  assert.deepEqual(out.map((x) => x.kind), ['result_md', 'report_md', 'agent_report_md']);
  assert.ok(out.every((x) => x.versions.length === 1));
});

test('groupArtifactHistory: same path under different kinds are distinct groups', () => {
  const rows = [
    a('m', 'team_md', 'p/teams/t1/team.json', '2026-05-25T00:00:00.000Z'),
    a('j', 'team_json', 'p/teams/t1/team.json', '2026-05-25T00:00:00.000Z'),
  ];
  const out = groupArtifactHistory(rows);
  assert.equal(out.length, 2);
});

test('groupArtifactHistory: does not mutate the caller input array', () => {
  const rows = [
    a('1', 'report_md', 'p/report.md', '2026-05-25T00:00:01.000Z'),
    a('2', 'report_md', 'p/report.md', '2026-05-25T00:00:03.000Z'),
    a('3', 'report_md', 'p/report.md', '2026-05-25T00:00:02.000Z'),
  ];
  const before = rows.map((r) => r.id);
  groupArtifactHistory(rows);
  assert.deepEqual(rows.map((r) => r.id), before); // input order/contents untouched
});

test('groupArtifactHistory: interleaved multi-group, multi-version (re-export-everything)', () => {
  const rows = [
    a('r1', 'report_md', 'p/report.md', '2026-05-25T00:00:01.000Z'),
    a('g1', 'agent_report_md', 'p/agent-reports/a.md', '2026-05-25T00:00:02.000Z'),
    a('r2', 'report_md', 'p/report.md', '2026-05-25T00:00:03.000Z'),
    a('g2', 'agent_report_md', 'p/agent-reports/a.md', '2026-05-25T00:00:04.000Z'),
  ];
  const out = groupArtifactHistory(rows);
  assert.deepEqual(out.map((x) => x.kind), ['report_md', 'agent_report_md']); // kind order
  assert.deepEqual(out[0]?.versions.map((v) => v.id), ['r2', 'r1']); // newest first
  assert.deepEqual(out[1]?.versions.map((v) => v.id), ['g2', 'g1']);
  assert.equal(out[0]?.latest.id, 'r2');
  assert.equal(out[1]?.latest.id, 'g2');
});
