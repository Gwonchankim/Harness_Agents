// runAgentTask — execute a single Task by streaming text from one agent.
// Tools are NOT invoked from inside the agent loop in Phase 4. Each task is
// a single-shot streamText. Chunks are batched up to DELTA_FLUSH_BYTES before
// being forwarded to the executor's `onDelta` callback (which appends a
// RunEvent + emits on the bus).

import { streamText } from '@lib/agents/runtime';
import { GenerateTimeoutError, resolvePoGenerateTimeoutMs } from '@lib/qa/timeout';

import { raiseProviderError } from './po';

const TASK_MAX_TOKENS = 2048;
const DELTA_FLUSH_BYTES = 1024;

export interface AgentTaskCtx {
  agent: {
    id: string;
    name: string;
    role: string;
    systemPrompt: string;
    modelId: string;
    provider: 'openai' | 'anthropic' | 'google' | 'ollama';
  };
  task: {
    taskKey: string;
    title: string;
    description: string;
    expectedOutput: string;
    dependencies: string[];
  };
  upstreamResults: Array<{ taskKey: string; agentName: string; text: string }>;
  userPrompt: string;
  signal?: AbortSignal;
  /** Called for each batched delta. Awaited so the caller can backpressure. */
  onDelta: (chunk: string) => Promise<void>;
}

export interface AgentTaskResult {
  text: string;
  bytes: number;
}

export async function runAgentTask(ctx: AgentTaskCtx): Promise<AgentTaskResult> {
  const messages = buildAgentMessages(ctx);
  const timeoutMs = resolvePoGenerateTimeoutMs(ctx.agent.provider);
  const composite = compositeAbort(ctx.signal, timeoutMs);

  let buffered = '';
  let bufferedBytes = 0;
  let completeText = '';

  try {
    const stream = await streamText({
      provider: ctx.agent.provider,
      modelId: ctx.agent.modelId,
      messages,
      temperature: 0.5,
      maxTokens: TASK_MAX_TOKENS,
      signal: composite.signal,
    });

    for await (const chunk of stream.textStream) {
      completeText += chunk;
      buffered += chunk;
      bufferedBytes += Buffer.byteLength(chunk, 'utf8');
      if (bufferedBytes >= DELTA_FLUSH_BYTES) {
        const toFlush = buffered;
        buffered = '';
        bufferedBytes = 0;
        await ctx.onDelta(toFlush);
      }
    }
    if (buffered.length > 0) {
      await ctx.onDelta(buffered);
    }
    return { text: completeText, bytes: Buffer.byteLength(completeText, 'utf8') };
  } catch (err) {
    if (composite.timedOut() && !(ctx.signal?.aborted ?? false)) {
      raiseProviderError(
        new GenerateTimeoutError(timeoutMs, {
          provider: ctx.agent.provider,
          modelId: ctx.agent.modelId,
        }),
        {
          provider: ctx.agent.provider,
          modelId: ctx.agent.modelId,
        },
      );
    }
    raiseProviderError(err, {
      provider: ctx.agent.provider,
      modelId: ctx.agent.modelId,
    });
  } finally {
    composite.clear();
  }
}

function buildAgentMessages(ctx: AgentTaskCtx) {
  const lines: string[] = [
    `User request: ${ctx.userPrompt}`,
    '',
    `Your task: ${ctx.task.title}`,
    `Description: ${ctx.task.description}`,
    `Expected output: ${ctx.task.expectedOutput}`,
  ];
  if (ctx.upstreamResults.length > 0) {
    lines.push('');
    lines.push('Upstream task results:');
    for (const r of ctx.upstreamResults) {
      lines.push(`- ${r.taskKey} (by ${r.agentName}):`);
      lines.push(r.text);
      lines.push('');
    }
  }
  lines.push('');
  lines.push('Produce the expected output. Keep it concise. Tools are not available.');
  return [
    {
      role: 'system' as const,
      content: `${ctx.agent.systemPrompt}\n\nYou are agent "${ctx.agent.name}" (${ctx.agent.role}). Tools are not available in this run.`,
    },
    { role: 'user' as const, content: lines.join('\n') },
  ];
}

interface CompositeAbort {
  signal: AbortSignal;
  timedOut: () => boolean;
  clear: () => void;
}

function compositeAbort(parent: AbortSignal | undefined, timeoutMs: number): CompositeAbort {
  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  let didTimeout = false;
  if (timeoutMs > 0) {
    const timer = setTimeout(() => {
      didTimeout = true;
      controller.abort(new Error('agent_task_timeout'));
    }, timeoutMs);
    cleanups.push(() => clearTimeout(timer));
  }
  if (parent) {
    if (parent.aborted) {
      controller.abort(parent.reason);
    } else {
      const onAbort = () => controller.abort(parent.reason);
      parent.addEventListener('abort', onAbort, { once: true });
      cleanups.push(() => parent.removeEventListener('abort', onAbort));
    }
  }
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    clear: () => {
      for (const fn of cleanups) fn();
    },
  };
}
