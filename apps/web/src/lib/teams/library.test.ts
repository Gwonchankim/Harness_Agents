import assert from 'node:assert/strict';
import { test } from 'node:test';

import { matchesTeamQuery } from './library';

const team = {
  name: 'EduGrowth AI Architect Team',
  description: 'Educational SaaS for deep work and learning analytics.',
  domain: 'EdTech SaaS',
  tags: ['AI', 'Gamification'],
};

test('matchesTeamQuery: matches name, description, domain, and tags', () => {
  assert.equal(matchesTeamQuery(team, 'EduGrowth'), true);
  assert.equal(matchesTeamQuery(team, 'learning analytics'), true);
  assert.equal(matchesTeamQuery(team, 'edtech'), true);
  assert.equal(matchesTeamQuery(team, 'gamification'), true);
});

test('matchesTeamQuery: requires every token to match', () => {
  assert.equal(matchesTeamQuery(team, 'EduGrowth analytics'), true);
  assert.equal(matchesTeamQuery(team, 'EduGrowth finance'), false);
});

test('matchesTeamQuery: empty query matches all teams', () => {
  assert.equal(matchesTeamQuery(team, ''), true);
  assert.equal(matchesTeamQuery(team, '   '), true);
  assert.equal(matchesTeamQuery(team, null), true);
});
