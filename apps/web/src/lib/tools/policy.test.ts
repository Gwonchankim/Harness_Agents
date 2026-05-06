import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { z } from 'zod';

import { evaluatePolicy } from './policy';
import type { AnyToolDefinition, ToolContext } from './types';

const baseCtx: ToolContext = { runId: 'run-1' };

const enabledTool: AnyToolDefinition = {
  name: 'fs.readFile',
  enabled: true,
  argsSchema: z.object({}),
  execute: async () => ({}),
};

const disabledTool: AnyToolDefinition = {
  name: 'web.search',
  enabled: false,
  argsSchema: z.object({}),
  execute: async () => ({}),
};

const offAllowlistTool: AnyToolDefinition = {
  name: 'shell.exec',
  enabled: true,
  argsSchema: z.object({}),
  execute: async () => ({}),
};

test('denies unregistered tools', () => {
  const out = evaluatePolicy({ toolName: 'fs.readFile', tool: undefined, ctx: baseCtx });
  assert.equal(out.allow, false);
  assert.match(out.reason, /tool_not_registered/);
});

test('denies tools not on the allowlist', () => {
  const out = evaluatePolicy({
    toolName: 'shell.exec',
    tool: offAllowlistTool,
    ctx: baseCtx,
  });
  assert.equal(out.allow, false);
  assert.match(out.reason, /tool_not_in_allowlist/);
});

test('denies disabled tools (web.search stub)', () => {
  const out = evaluatePolicy({
    toolName: 'web.search',
    tool: disabledTool,
    ctx: baseCtx,
  });
  assert.equal(out.allow, false);
  assert.match(out.reason, /tool_disabled/);
});

test('denies when agent toolsAllowed excludes the tool', () => {
  const out = evaluatePolicy({
    toolName: 'fs.readFile',
    tool: enabledTool,
    ctx: { ...baseCtx, agentToolsAllowed: ['fs.listDir'] },
  });
  assert.equal(out.allow, false);
  assert.match(out.reason, /tool_not_allowed_for_agent/);
});

test('allows registered, enabled, allowlisted tool', () => {
  const out = evaluatePolicy({
    toolName: 'fs.readFile',
    tool: enabledTool,
    ctx: baseCtx,
  });
  assert.equal(out.allow, true);
  assert.equal(out.reason, 'ok');
});

test('allows when agent toolsAllowed includes the tool', () => {
  const out = evaluatePolicy({
    toolName: 'fs.readFile',
    tool: enabledTool,
    ctx: { ...baseCtx, agentToolsAllowed: ['fs.readFile', 'fs.listDir'] },
  });
  assert.equal(out.allow, true);
});
