import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  buildSnapshot,
  toAgentsMd,
  toTeamJson,
  type SerializableAgent,
  type SerializableTeam,
} from './serialize';

const team: SerializableTeam = {
  name: 'Research Squad',
  description: 'Investigates open questions and produces a brief.',
  domain: 'research',
  tags: ['research', 'briefing'],
};

const agents: SerializableAgent[] = [
  {
    name: 'Beta',
    role: 'Researcher',
    isLead: false,
    modelId: 'claude-haiku-4-5-20251001',
    provider: 'anthropic',
    systemPrompt: 'You collect sources and synthesize findings.',
    toolsAllowed: ['fs.readFile'],
    tags: ['research'],
  },
  {
    name: 'Alpha',
    role: 'Lead Researcher',
    isLead: true,
    modelId: 'claude-sonnet-4-6',
    provider: 'anthropic',
    systemPrompt: 'You orchestrate the team and synthesize findings.',
    toolsAllowed: [],
    tags: ['lead'],
  },
];

test('toAgentsMd places the lead first and lists each agent', () => {
  const md = toAgentsMd(team, agents);
  const alphaIdx = md.indexOf('### Alpha');
  const betaIdx = md.indexOf('### Beta');
  assert.ok(alphaIdx !== -1, 'Alpha section present');
  assert.ok(betaIdx !== -1, 'Beta section present');
  assert.ok(alphaIdx < betaIdx, 'lead Alpha appears before Beta');
  assert.match(md, /# Research Squad/);
  assert.match(md, /- Lead: Alpha/);
  assert.match(md, /Tools: none/);
  assert.match(md, /Tools: fs\.readFile/);
});

test('toAgentsMd is deterministic for identical input', () => {
  const a = toAgentsMd(team, agents);
  const b = toAgentsMd(team, [...agents].reverse());
  assert.equal(a, b);
});

test('toTeamJson round-trips through JSON.parse with stable shape', () => {
  const text = toTeamJson(team, agents);
  const parsed = JSON.parse(text);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.team.name, 'Research Squad');
  assert.equal(parsed.team.tags.length, 2);
  assert.equal(parsed.agents.length, 2);
  assert.equal(parsed.agents[0].isLead, true, 'lead listed first');
  assert.equal(parsed.agents[0].name, 'Alpha');
  assert.equal(parsed.agents[1].name, 'Beta');
  assert.ok(Array.isArray(parsed.toolAllowlistAtExport));
});

test('toTeamJson includes the runtime tool allowlist', () => {
  const parsed = JSON.parse(toTeamJson(team, agents));
  assert.ok(parsed.toolAllowlistAtExport.includes('fs.readFile'));
  assert.ok(parsed.toolAllowlistAtExport.includes('fs.writeFile'));
  assert.ok(parsed.toolAllowlistAtExport.includes('fs.listDir'));
  assert.ok(parsed.toolAllowlistAtExport.includes('web.search'));
});

test('buildSnapshot returns both formats', () => {
  const snap = buildSnapshot(team, agents);
  assert.ok(snap.agentsMd.startsWith('# Research Squad'));
  const parsed = JSON.parse(snap.teamJson);
  assert.equal(parsed.team.name, 'Research Squad');
});

test('toAgentsMd handles empty optional fields without throwing', () => {
  const minimalTeam: SerializableTeam = { name: 'Solo', tags: [] };
  const minimalAgents: SerializableAgent[] = [
    {
      name: 'Only',
      role: 'Sole agent',
      isLead: true,
      modelId: 'claude-haiku-4-5-20251001',
      provider: 'anthropic',
      systemPrompt: 'You do everything.',
      toolsAllowed: [],
      tags: [],
    },
  ];
  const md = toAgentsMd(minimalTeam, minimalAgents);
  assert.match(md, /# Solo/);
  assert.match(md, /### Only \(Lead\)/);
});
