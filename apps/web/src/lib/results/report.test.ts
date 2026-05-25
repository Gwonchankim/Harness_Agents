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

test('buildRunReportMarkdown: Attempts column + Attempt summary when attempts present', () => {
  const md = buildRunReportMarkdown({
    runId: 'run3',
    userPrompt: 'p',
    teamName: 'T',
    status: 'succeeded',
    rationale: null,
    agents: [{ name: 'Worker', role: 'w', modelId: 'm', provider: 'google', isLead: false }],
    tasks: [
      {
        taskKey: 't1',
        title: 'T1',
        agentName: 'Worker',
        status: 'done',
        durationMs: 1000,
        outputBytes: 5,
        error: null,
        attempts: [
          { attemptNumber: 1, status: 'done', source: 'initial', durationMs: 500, resultBytes: 5, error: null },
          { attemptNumber: 2, status: 'done', source: 'rerun_from_task', durationMs: 600, resultBytes: 7, error: null },
        ],
      },
    ],
    startedAt: null,
    endedAt: null,
  });
  assert.match(md, /\| Attempts \|/);
  assert.match(md, /## Attempt summary/);
  assert.match(md, /Total attempts: 2 across 1 task/);
  assert.match(md, /rerun_from_task/);
});

test('buildRunReportMarkdown: no Attempts column/section for historical run (attempts absent)', () => {
  const md = buildRunReportMarkdown({
    runId: 'run4',
    userPrompt: 'p',
    teamName: 'T',
    status: 'succeeded',
    rationale: null,
    agents: [],
    tasks: [{ taskKey: 't1', title: 'T1', agentName: 'W', status: 'done', durationMs: 100, outputBytes: 1, error: null }],
    startedAt: null,
    endedAt: null,
  });
  assert.doesNotMatch(md, /## Attempt summary/);
  assert.doesNotMatch(md, /\| Attempts \|/);
});
