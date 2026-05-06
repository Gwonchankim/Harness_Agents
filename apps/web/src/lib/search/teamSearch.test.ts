import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  clamp01,
  jaccard,
  scoreTeams,
  tokenize,
  type RankableTeam,
} from './teamSearch';

function team(overrides: Partial<RankableTeam> = {}): RankableTeam {
  return {
    id: overrides.id ?? 't1',
    name: overrides.name ?? 'Generic Team',
    description: overrides.description ?? null,
    domain: overrides.domain ?? null,
    tags: overrides.tags ?? [],
    score: overrides.score ?? null,
    leadAgentName: overrides.leadAgentName ?? null,
    agentCount: overrides.agentCount ?? 5,
  };
}

// ---------------------------------------------------------------------------
// pure helpers
// ---------------------------------------------------------------------------

test('tokenize lowercases, drops short and stopwords', () => {
  const tokens = tokenize('The quick brown fox is in the box');
  assert.ok(!tokens.has('the'));
  assert.ok(!tokens.has('is'));
  assert.ok(tokens.has('quick'));
  assert.ok(tokens.has('brown'));
  assert.ok(tokens.has('fox'));
  assert.ok(tokens.has('box'));
});

test('jaccard computes intersection / union', () => {
  const a = new Set(['a', 'b', 'c']);
  const b = new Set(['b', 'c', 'd']);
  assert.equal(jaccard(a, b), 2 / 4);
  assert.equal(jaccard(new Set<string>(), new Set<string>()), 0);
  assert.equal(jaccard(new Set(['x']), new Set<string>()), 0);
});

test('clamp01 clips to [0, 1]', () => {
  assert.equal(clamp01(-0.5), 0);
  assert.equal(clamp01(1.5), 1);
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(0.42), 0.42);
});

// ---------------------------------------------------------------------------
// scoreTeams — empty and ranking
// ---------------------------------------------------------------------------

test('scoreTeams returns empty for empty Project', () => {
  const out = scoreTeams({ prompt: 'anything', historyLines: [] }, []);
  assert.deepEqual(out, []);
});

test('scoreTeams ranks by total score, descending', () => {
  const teams: RankableTeam[] = [
    team({ id: 't1', name: 'Research bots', description: 'collect briefings', tags: ['research'] }),
    team({ id: 't2', name: 'Marketing crew', description: 'write copy', tags: ['marketing'] }),
    team({
      id: 't3',
      name: 'Research and briefing squad',
      description: 'research briefings',
      domain: 'research',
      tags: ['research', 'briefing'],
      score: 5,
    }),
  ];
  const out = scoreTeams(
    {
      prompt: 'I need a research briefing on quantum computing',
      historyLines: [],
      domain: 'research',
      tags: ['research', 'briefing'],
    },
    teams,
    3,
  );
  assert.equal(out[0]?.teamId, 't3', 'best-matching team ranks first');
  assert.equal(out.length, 3);
  assert.ok(out[0]!.score.total >= out[1]!.score.total);
  assert.ok(out[1]!.score.total >= out[2]!.score.total);
});

test('scoreTeams treats null score as 0 (no NaN leaks)', () => {
  const out = scoreTeams(
    { prompt: 'x', historyLines: [] },
    [team({ id: 't1', name: 'unknown' })],
  );
  assert.ok(Number.isFinite(out[0]!.score.total));
  assert.ok(out[0]!.score.historyScore >= 0);
});

test('scoreTeams domain match boosts a team with matching domain', () => {
  const teams: RankableTeam[] = [
    team({ id: 'a', name: 'Alpha', domain: 'research' }),
    team({ id: 'b', name: 'Beta', domain: 'sales' }),
  ];
  const out = scoreTeams(
    { prompt: 'something', historyLines: [], domain: 'research' },
    teams,
    2,
  );
  assert.equal(out[0]?.teamId, 'a');
  assert.equal(out[0]?.score.domainScore, 1);
  assert.equal(out[1]?.score.domainScore, 0);
});

test('scoreTeams tag overlap contributes to ranking', () => {
  const teams: RankableTeam[] = [
    team({ id: 'a', name: 'Alpha', tags: ['research', 'briefing'] }),
    team({ id: 'b', name: 'Beta', tags: ['marketing'] }),
  ];
  const out = scoreTeams(
    { prompt: '...', historyLines: [], tags: ['research', 'briefing'] },
    teams,
    2,
  );
  assert.equal(out[0]?.teamId, 'a');
  assert.ok(out[0]!.score.tagScore > out[1]!.score.tagScore);
});

test('scoreTeams limit caps the result count', () => {
  const teams: RankableTeam[] = Array.from({ length: 8 }, (_, i) =>
    team({ id: `t${i}`, name: `team-${i}` }),
  );
  const out = scoreTeams({ prompt: 'team', historyLines: [] }, teams, 3);
  assert.equal(out.length, 3);
});
