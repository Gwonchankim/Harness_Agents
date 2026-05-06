// Tool policy engine. Pure function — no DB writes here. The registry calls
// evaluatePolicy() before every invocation and persists the decision in
// ToolCall.

import type { AnyToolDefinition, PolicyResult, ToolContext } from './types';

/** Allowlist of tool names that may be invoked by an Agent in MVP. */
export const ALLOWED_TOOL_NAMES: readonly string[] = [
  'fs.readFile',
  'fs.writeFile',
  'fs.listDir',
  'web.search',
];

export interface PolicyInput {
  toolName: string;
  tool: AnyToolDefinition | undefined;
  ctx: ToolContext;
}

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const { toolName, tool, ctx } = input;

  if (!tool) {
    return { allow: false, reason: `tool_not_registered: ${toolName}` };
  }
  if (!ALLOWED_TOOL_NAMES.includes(toolName)) {
    return { allow: false, reason: `tool_not_in_allowlist: ${toolName}` };
  }
  if (!tool.enabled) {
    return { allow: false, reason: `tool_disabled: ${toolName}` };
  }
  if (
    ctx.agentToolsAllowed !== undefined &&
    !ctx.agentToolsAllowed.includes(toolName)
  ) {
    return { allow: false, reason: `tool_not_allowed_for_agent: ${toolName}` };
  }
  return { allow: true, reason: 'ok' };
}
