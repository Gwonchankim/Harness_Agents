// Tool registry types. A Tool is a server-side capability that an Agent can
// invoke through invokeTool(). Every invocation goes through the policy
// engine, so Tool implementations never enforce permissions themselves.

import type { z } from 'zod';

export interface ToolContext {
  /** Run that owns the invocation. Required for ToolCall logging. */
  runId: string;
  /** Optional task scope. */
  taskId?: string | null;
  /** Optional agent scope (matters for policy). */
  agentId?: string | null;
  /** JSON-encoded toolsAllowed list of the calling agent, if any. */
  agentToolsAllowed?: readonly string[];
}

export interface ToolDefinition<TArgs = unknown, TResult = unknown> {
  /** Canonical name, e.g. "fs.readFile". */
  name: string;
  /** When false, the tool is registered but every invocation is denied. */
  enabled: boolean;
  /** Zod schema for the args object. */
  argsSchema: z.ZodType<TArgs>;
  /** Implementation. Should throw on failure; the registry handles logging. */
  execute: (args: TArgs, ctx: ToolContext) => Promise<TResult>;
  /** Optional human-readable summary for diagnostics. */
  description?: string;
}

export type AnyToolDefinition = ToolDefinition<unknown, unknown>;

export interface PolicyResult {
  allow: boolean;
  reason: string;
}
