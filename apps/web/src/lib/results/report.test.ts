import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRunReportMarkdown } from './report';

test('buildRunReportMarkdown: overview, timeline, failures, outputs', () => {
  const md = buildRunReportMarkdown({
    runId: 'run1',
    userPrompt: 'do x',
    teamName: 'Team A',
    status: 'succeeded',
    rationale: 'because reasons',
    agents: [
      { name: 'Lead', role: 'lead', modelId: 'm', provider: 'openai', isLead: true },
      { name: 'Worker', role: 'worker', modelId: 'm', provider: 'openai', isLead: false },
    ],
    tasks: [
      { taskKey: 't1', title: 'T1', agentName: 'Worker', status: 'done', durationMs: 1500, outputBytes: 10, error: null },
      { taskKey: 't2', title: 'T2', agentName: 'Worker', status: 'failed', durationMs: 200, outputBytes: null, error: 'boom' },
    ],
    startedAt: '2026-05-24T00:00:00.000Z',
    endedAt: '2026-05-24T00:00:05.000Z',
  });

  assert.match(md, /# Run report — Team A/);
  assert.match(md, /Lead: Lead/);
  assert.match(md, /## Task timeline/);
  assert.match(md, /`t1`/);
  assert.match(md, /## Failures/);
  assert.match(md, /boom/);
  assert.match(md, /result\.md/);
});

test('buildRunReportMarkdown: no tasks is handled', () => {
  const md = buildRunReportMarkdown({
    runId: 'run2',
    userPrompt: 'x',
    teamName: 'T',
    status: 'succeeded',
    rationale: null,
    agents: [],
    tasks: [],
    startedAt: null,
    endedAt: null,
  });
  assert.match(md, /No tasks were recorded/);
});
