import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planGroupCleanup, summarizeCleanupPlan } from './artifactCleanupPlan';

// Minimal newest-first version factory (id / bytes / sha256).
function v(id: string, bytes: number, sha256: string | null = null) {
  return { id, bytes, sha256 };
}

// --- planGroupCleanup ---

test('planGroupCleanup: empty → keep none, nothing to clean', () => {
  assert.deepEqual(planGroupCleanup([]), {
    keepLatestId: null,
    olderRows: 0,
    representedHistoricalBytes: 0,
    loadedLinkedEventsAffected: 0,
  });
});

test('planGroupCleanup: single version → keep latest, 0 older, no breakdown', () => {
  assert.deepEqual(planGroupCleanup([v('1', 100, 'a')]), {
    keepLatestId: '1',
    olderRows: 0,
    representedHistoricalBytes: 0,
    loadedLinkedEventsAffected: 0,
  });
});

test('planGroupCleanup: multi-version same content (same sha) over older rows', () => {
  // newest-first: 3 (latest) / 2 / 1
  const plan = planGroupCleanup([v('3', 30, 'a'), v('2', 20, 'a'), v('1', 10, 'a')]);
  assert.equal(plan.keepLatestId, '3');
  assert.equal(plan.olderRows, 2);
  assert.equal(plan.representedHistoricalBytes, 30); // 20 + 10
  assert.equal(plan.changedVersions, 1); // older rows all sha 'a'
  assert.equal(plan.sameContentRows, 1); // 2 older non-null, 1 distinct → 1 extra
  assert.equal(plan.loadedLinkedEventsAffected, 0);
});

test('planGroupCleanup: multi-version changed content (distinct shas among older)', () => {
  const plan = planGroupCleanup([v('3', 30, 'a'), v('2', 20, 'b'), v('1', 10, 'c')]);
  assert.equal(plan.olderRows, 2);
  assert.equal(plan.representedHistoricalBytes, 30); // 20 + 10
  assert.equal(plan.changedVersions, 2); // b, c
  assert.equal(plan.sameContentRows, 0);
});

test('planGroupCleanup: all-null sha older rows → no breakdown', () => {
  const plan = planGroupCleanup([v('2', 20, null), v('1', 10, null)]);
  assert.equal(plan.keepLatestId, '2');
  assert.equal(plan.olderRows, 1);
  assert.equal(plan.representedHistoricalBytes, 10);
  assert.equal(plan.changedVersions, undefined);
  assert.equal(plan.sameContentRows, undefined);
});

test('planGroupCleanup: mixed null + non-null older (nulls excluded from breakdown)', () => {
  // older = [2(sha a), 1(null)]
  const plan = planGroupCleanup([v('3', 30, 'b'), v('2', 20, 'a'), v('1', 10, null)]);
  assert.equal(plan.olderRows, 2);
  assert.equal(plan.representedHistoricalBytes, 30); // 20 + 10 (bytes counted regardless of sha)
  assert.equal(plan.changedVersions, 1); // only sha 'a' among older non-null
  assert.equal(plan.sameContentRows, 0);
});

test('planGroupCleanup: representedHistoricalBytes = sum of non-latest bytes', () => {
  const plan = planGroupCleanup([v('4', 500, 'd'), v('3', 200, 'c'), v('2', 150, 'b'), v('1', 100, 'a')]);
  assert.equal(plan.representedHistoricalBytes, 200 + 150 + 100);
});

test('planGroupCleanup: linkedArtifactIds on older rows counted', () => {
  const plan = planGroupCleanup([v('3', 30, 'a'), v('2', 20, 'a'), v('1', 10, 'a')], new Set(['2', '1']));
  assert.equal(plan.loadedLinkedEventsAffected, 2);
});

test('planGroupCleanup: linkedArtifactIds on latest only → 0 affected', () => {
  const plan = planGroupCleanup([v('3', 30, 'a'), v('2', 20, 'a')], new Set(['3']));
  assert.equal(plan.loadedLinkedEventsAffected, 0);
});

test('planGroupCleanup: does not mutate inputs', () => {
  const versions = [v('2', 20, 'a'), v('1', 10, 'a')];
  const linked = new Set(['1']);
  const vCopy = versions.map((x) => ({ ...x }));
  const lCopy = new Set(linked);
  planGroupCleanup(versions, linked);
  assert.deepEqual(versions, vCopy);
  assert.deepEqual(linked, lCopy);
});

// --- summarizeCleanupPlan ---

test('summarizeCleanupPlan: empty → zeros', () => {
  assert.deepEqual(summarizeCleanupPlan([]), {
    totalGroups: 0,
    cleanupCandidateRows: 0,
    affectedGroups: 0,
    representedHistoricalBytes: 0,
    loadedLinkedEventsAffected: 0,
  });
});

test('summarizeCleanupPlan: single group single version → no candidates', () => {
  const s = summarizeCleanupPlan([{ id: 'a', versionCount: 1, representedHistoricalBytes: 0 }]);
  assert.equal(s.totalGroups, 1);
  assert.equal(s.cleanupCandidateRows, 0);
  assert.equal(s.affectedGroups, 0);
  assert.equal(s.representedHistoricalBytes, 0);
});

test('summarizeCleanupPlan: missing versionCount treated as 1', () => {
  const s = summarizeCleanupPlan([{ id: 'a' }]);
  assert.equal(s.cleanupCandidateRows, 0);
  assert.equal(s.affectedGroups, 0);
});

test('summarizeCleanupPlan: mixed groups aggregate candidate rows + represented bytes', () => {
  const s = summarizeCleanupPlan([
    { id: 'r', versionCount: 3, representedHistoricalBytes: 400 },
    { id: 'p', versionCount: 1, representedHistoricalBytes: 0 },
    { id: 'a', versionCount: 2, representedHistoricalBytes: 150 },
  ]);
  assert.equal(s.totalGroups, 3);
  assert.equal(s.cleanupCandidateRows, 2 + 0 + 1);
  assert.equal(s.affectedGroups, 2);
  assert.equal(s.representedHistoricalBytes, 400 + 0 + 150);
});

test('summarizeCleanupPlan: loadedLinkedEventsAffected counts linked ids not kept-latest', () => {
  const s = summarizeCleanupPlan(
    [{ id: 'L', versionCount: 3, representedHistoricalBytes: 400 }],
    new Set(['old1', 'old2', 'L']),
  );
  assert.equal(s.loadedLinkedEventsAffected, 2); // old1, old2 (L is kept-latest)
});

test('summarizeCleanupPlan: does not mutate inputs', () => {
  const metas = [{ id: 'a', versionCount: 2, representedHistoricalBytes: 100 }];
  const linked = new Set(['x']);
  const mCopy = metas.map((m) => ({ ...m }));
  const lCopy = new Set(linked);
  summarizeCleanupPlan(metas, linked);
  assert.deepEqual(metas, mCopy);
  assert.deepEqual(linked, lCopy);
});
