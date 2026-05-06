// In-process tool registry. Every invocation:
//   1. Looks up the tool by name.
//   2. Asks the policy engine for an allow/deny decision.
//   3. On deny, writes a ToolCall row with status='denied' and throws.
//   4. On allow, validates args via Zod, executes, and writes a ToolCall row
//      with status='done' (or 'failed' if execute threw).
// Args and results are redacted before being JSON-encoded into the row.

import { prisma } from '@db/client';

import { stringifyJson } from '@lib/db/json';
import { redact } from '@lib/secrets/redactor';

import { evaluatePolicy } from './policy';
import type { AnyToolDefinition, ToolContext, ToolDefinition } from './types';

const tools = new Map<string, AnyToolDefinition>();

export function registerTool<TArgs, TResult>(tool: ToolDefinition<TArgs, TResult>): void {
  tools.set(tool.name, tool as AnyToolDefinition);
}

export function getTool(name: string): AnyToolDefinition | undefined {
  return tools.get(name);
}

export function listToolNames(): string[] {
  return Array.from(tools.keys()).sort();
}

export function clearToolsForTests(): void {
  tools.clear();
}

export class ToolDeniedError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly reason: string,
  ) {
    super(`tool_denied: ${toolName}: ${reason}`);
    this.name = 'ToolDeniedError';
  }
}

export interface InvokeResult<T> {
  toolCallId: string;
  result: T;
}

export async function invokeTool<T = unknown>(
  ctx: ToolContext,
  name: string,
  rawArgs: unknown,
): Promise<InvokeResult<T>> {
  const tool = tools.get(name);
  const policy = evaluatePolicy({ toolName: name, tool, ctx });

  if (!policy.allow) {
    const denied = await prisma.toolCall.create({
      data: {
        runId: ctx.runId,
        taskId: ctx.taskId ?? null,
        agentId: ctx.agentId ?? null,
        toolName: name,
        args: stringifyJson(redact(rawArgs)),
        result: stringifyJson({ denied: true, reason: policy.reason }),
        status: 'denied',
        startedAt: new Date(),
        endedAt: new Date(),
      },
      select: { id: true },
    });
    throw Object.assign(new ToolDeniedError(name, policy.reason), {
      toolCallId: denied.id,
    });
  }

  const definition = tool as AnyToolDefinition;
  const startedAt = new Date();
  let parsedArgs: unknown;
  try {
    parsedArgs = definition.argsSchema.parse(rawArgs);
  } catch (err) {
    const failed = await prisma.toolCall.create({
      data: {
        runId: ctx.runId,
        taskId: ctx.taskId ?? null,
        agentId: ctx.agentId ?? null,
        toolName: name,
        args: stringifyJson(redact(rawArgs)),
        result: stringifyJson({
          error: 'invalid_args',
          message: err instanceof Error ? err.message : String(err),
        }),
        status: 'failed',
        startedAt,
        endedAt: new Date(),
      },
      select: { id: true },
    });
    throw Object.assign(new Error(`invalid_args: ${name}`), { toolCallId: failed.id });
  }

  try {
    const result = (await definition.execute(parsedArgs, ctx)) as T;
    const ok = await prisma.toolCall.create({
      data: {
        runId: ctx.runId,
        taskId: ctx.taskId ?? null,
        agentId: ctx.agentId ?? null,
        toolName: name,
        args: stringifyJson(redact(parsedArgs)),
        result: stringifyJson(redact(result)),
        status: 'done',
        startedAt,
        endedAt: new Date(),
      },
      select: { id: true },
    });
    return { toolCallId: ok.id, result };
  } catch (err) {
    const failure = await prisma.toolCall.create({
      data: {
        runId: ctx.runId,
        taskId: ctx.taskId ?? null,
        agentId: ctx.agentId ?? null,
        toolName: name,
        args: stringifyJson(redact(parsedArgs)),
        result: stringifyJson({
          error: 'execute_failed',
          message: err instanceof Error ? err.message : String(err),
        }),
        status: 'failed',
        startedAt,
        endedAt: new Date(),
      },
      select: { id: true },
    });
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
      toolCallId: failure.id,
    });
  }
}
