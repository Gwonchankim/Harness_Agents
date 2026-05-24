import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildAgentReportMarkdown } from './agentReport';

test('buildAgentReportMarkdown: profile + task output', () => {
  const md = buildAgentReportMarkdown({
    agentId: 'a1',
    agentName: 'Writer',
    role: 'writes drafts',
    modelId: 'm',
    provider: 'openai',
    isLead: false,
    tasks: [
      {
        taskKey: 't1',
        title: 'Draft',
        description: 'write a draft',
        expectedOutput: '200 words',
        status: 'done',
        durationMs: 1000,
        text: 'hello world',
        error: null,
      },
    ],
  });
  assert.match(md, /# Writer — agent report/);
  assert.match(md, /## Profile/);
  assert.match(md, /Draft/);
  assert.match(md, /Expected output/);
  assert.match(md, /hello world/);
});

test('buildAgentReportMarkdown: no tasks', () => {
  const md = buildAgentReportMarkdown({
    agentId: 'a1',
    agentName: 'Lead',
    role: 'leads',
    modelId: 'm',
    provider: 'openai',
    isLead: true,
    tasks: [],
  });
  assert.match(md, /# Lead \(Lead\) — agent report/);
  assert.match(md, /not assigned any tasks/);
});
