// DAG executor. Single in-process orchestrator: takes a Run that is `ready`,
// asks the Lead for an ExecutionPlan, persists the plan + Task rows, then runs
// each task sequentially through the worker. Concurrency=1 in MVP; the API
// shape accepts a concurrency arg so future Phase 4.x can introduce a worker
// pool without changing callers.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { prisma } from '@db/client';
import { parseJson, stringifyJson } from '@lib/db/json';

import {
  LeadPlanInvalidError,
  proposeExecutionPlan,
  type ExecutionPlanPayload,
} from '@lib/agents/lead';
import { runAgentTask } from '@lib/agents/worker';
import { classifyGenerateError } from '@lib/agents/providerError';
import { nextBackoff } from '@lib/runs/backoffPolicy';
import { topoSort } from './topo';
import { appendEvent } from '@lib/events/append';
import { buildHistoryLines, loadSession } from '@lib/qa/sessionState';
import {
  buildFinalResultMarkdown,
  exportRunResultMd,
} from '@lib/results/finalResult';
import { exportRunReports } from '@lib/results/exportReports';
import {
  resolveProviderName,
  UnknownProviderError,
} from '@lib/models/catalog';
import { safeJoin, workspaceRoot } from '@lib/workspace/paths';
import { redactString } from '@lib/secrets/redactor';
import {
  GenerateAbortedError,
  GenerateTimeoutError,
} from '@lib/qa/timeout';
import {
  ModelNotFoundError,
  PoAuthError,
  PoSchemaError,
  ProviderUnavailableError,
  RateLimitError,
} from '@lib/agents/po';

const inFlight = new Set<string>();

export interface ExecuteOptions {
  /** MVP only honors 1; future Phase 4.x will accept >1. */
  concurrency?: number;
  signal?: AbortSignal;
}

/**
 * Execute one Run through plan generation + sequential task execution. The
 * caller is expected to have just transitioned `Run.status` from `ready` (the
 * /start route) and to fire-and-forget this; the function emits events and
 * updates DB rows on its own.
 */
export async function executeRun(runId: string, opts: ExecuteOptions = {}): Promise<void> {
  const concurrency = opts.concurrency ?? 1;
  if (concurrency !== 1) {
    throw new Error('concurrency_not_implemented');
  }
  if (inFlight.has(runId)) return;
  inFlight.add(runId);
  try {
    await executeInner(runId, opts.signal);
  } finally {
    inFlight.delete(runId);
  }
}

/**
 * Phase 8 partial resume. The caller (lib/runs/resume.ts via the /resume route)
 * has already reset the failed/cancelled tasks to `pending` and set the run to
 * `running`. This skips planning entirely: it loads the existing ExecutionPlan +
 * Task rows, seeds the in-memory results from the tasks that are already `done`
 * (so their outputs are reused as upstream context), then runs only the remaining
 * non-done tasks in topo order. Cancellable via the same signal as executeRun.
 */
export async function executeResume(runId: string, opts: ExecuteOptions = {}): Promise<void> {
  const concurrency = opts.concurrency ?? 1;
  if (concurrency !== 1) {
    throw new Error('concurrency_not_implemented');
  }
  if (inFlight.has(runId)) return;
  inFlight.add(runId);
  try {
    await resumeInner(runId, opts.signal);
  } finally {
    inFlight.delete(runId);
  }
}

async function resumeInner(runId: string, signal?: AbortSignal): Promise<void> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      prompt: true,
      status: true,
      teamId: true,
      project: { select: { slug: true } },
      team: {
        select: {
          id: true,
          name: true,
          agents: {
            select: {
              id: true,
              name: true,
              role: true,
              isLead: true,
              systemPrompt: true,
              modelId: true,
              provider: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
      plan: { select: { id: true } },
    },
  });

  if (!run) return;
  // resume.ts set status to 'running' before firing; bail if something else moved it.
  if (run.status !== 'running') return;
  if (!run.team) {
    await markRunFailed(runId, 'run_has_no_team');
    return;
  }
  if (!run.plan) {
    await markRunFailed(runId, 'resume_no_plan');
    return;
  }

  const taskRows = await prisma.task.findMany({
    where: { runId, planId: run.plan.id },
    orderBy: { createdAt: 'asc' },
  });
  const taskNodes = taskRows.map((t) => ({
    id: t.id,
    taskKey: t.taskKey,
    agentId: t.agentId,
    title: t.name,
    description: t.description,
    expectedOutput: t.expectedOutput ?? '',
    dependencies: parseJson<string[]>(t.dependencies, []),
  }));

  let order: typeof taskNodes;
  try {
    order = topoSort(taskNodes);
  } catch (err) {
    const reason = `dag_invalid:${err instanceof Error ? err.name : 'unknown'}`;
    await markRunFailed(runId, reason);
    await appendEvent({
      runId,
      type: 'run.completed',
      payload: { success: false, succeededTasks: 0, failedTasks: 0, failedReason: reason },
    });
    return;
  }

  // Seed results from tasks already done so they are reused as upstream context.
  const taskResults = new Map<string, string>();
  const doneKeys = new Set<string>();
  for (const row of taskRows) {
    if (row.status === 'done') {
      doneKeys.add(row.taskKey);
      if (row.result) {
        const { text } = parseJson<{ text?: string }>(row.result, {});
        if (typeof text === 'string') taskResults.set(row.taskKey, text);
      }
    }
  }

  let succeededTasks = doneKeys.size;

  for (const t of order) {
    if (signal?.aborted) return; // cancel.ts owns the cancelled terminal state
    if (doneKeys.has(t.taskKey)) continue; // already done; result already seeded
    const outcome = await runOneTask({
      runId,
      userPrompt: run.prompt,
      agents: run.team.agents,
      taskNodes,
      taskResults,
      task: t,
      signal,
    });
    if (outcome === 'aborted') return;
    if (outcome === 'failed') {
      await markRunFailed(runId, `task_failed:${t.taskKey}`);
      await appendEvent({
        runId,
        type: 'run.completed',
        payload: {
          success: false,
          succeededTasks,
          failedTasks: 1,
          failedReason: `task_failed:${t.taskKey}`,
        },
      });
      return;
    }
    succeededTasks += 1;
  }

  if (signal?.aborted) return;

  await exportFinalResult({
    projectSlug: run.project.slug,
    runId,
    userPrompt: run.prompt,
    teamName: run.team.name,
    tasks: order.map((t) => {
      const agent = run.team!.agents.find((a) => a.id === t.agentId);
      return {
        taskKey: t.taskKey,
        title: t.title,
        agentName: agent?.name ?? 'Unknown agent',
        text: taskResults.get(t.taskKey) ?? '',
      };
    }),
  });

  await prisma.run.update({
    where: { id: runId },
    data: { status: 'succeeded', endedAt: new Date() },
  });
  await appendEvent({
    runId,
    type: 'run.completed',
    payload: { success: true, succeededTasks, failedTasks: 0 },
  });

  try {
    await exportRunReports(runId);
  } catch (err) {
    console.error('run reports export failed:', err);
  }
}

async function executeInner(runId: string, signal?: AbortSignal): Promise<void> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      projectId: true,
      prompt: true,
      status: true,
      teamId: true,
      qaSession: { select: { id: true } },
      project: { select: { slug: true } },
      team: {
        select: {
          id: true,
          name: true,
          description: true,
          leadAgentId: true,
          agents: {
            select: {
              id: true,
              name: true,
              role: true,
              isLead: true,
              systemPrompt: true,
              modelId: true,
              provider: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'asc' },
          },
        },
      },
    },
  });

  if (!run) return;
  if (!run.team) {
    await markRunFailed(runId, 'run_has_no_team');
    return;
  }
  if (run.status !== 'ready') {
    return;
  }

  const lead = run.team.agents.find((a) => a.isLead);
  if (!lead) {
    await markRunFailed(runId, 'team_has_no_lead');
    return;
  }

  const startedAt = new Date();
  await prisma.run.update({
    where: { id: runId },
    data: { status: 'planning', startedAt },
  });
  await appendEvent({ runId, type: 'run.started', payload: { teamId: run.team.id } });

  let historyLines: string[] = [];
  if (run.qaSession) {
    const view = await loadSession(run.qaSession.id);
    if (view) historyLines = buildHistoryLines(view);
  }

  const agentsForLead = run.team.agents.map((a) => ({
    name: a.name,
    role: a.role,
    modelLabel: `${a.provider}/${a.modelId}`,
    isLead: a.isLead,
  }));

  let plan: ExecutionPlanPayload;
  try {
    plan = await proposeExecutionPlan({
      modelId: lead.modelId,
      userPrompt: run.prompt,
      historyLines,
      teamName: run.team.name,
      teamDescription: run.team.description,
      agents: agentsForLead,
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return; // cancel.ts owns the cancelled terminal state
    const reason = mapPlanErrorReason(err);
    await markRunFailed(runId, reason);
    await appendEvent({
      runId,
      type: 'run.completed',
      payload: {
        success: false,
        succeededTasks: 0,
        failedTasks: 0,
        failedReason: reason,
      },
    });
    return;
  }

  // A cancel that landed during planning has already written the terminal state.
  if (signal?.aborted) return;

  const agentByName = new Map(run.team.agents.map((a) => [a.name, a] as const));
  const planRow = await prisma.$transaction(async (tx) => {
    const created = await tx.executionPlan.create({
      data: {
        runId: run.id,
        dagJson: stringifyJson({
          tasks: plan.tasks.map((t) => ({
            taskKey: t.taskKey,
            assignedAgentName: t.assignedAgentName,
            dependencies: t.dependencies,
          })),
        }),
        rationale: plan.rationale,
      },
      select: { id: true },
    });
    for (const t of plan.tasks) {
      const ag = agentByName.get(t.assignedAgentName);
      await tx.task.create({
        data: {
          runId: run.id,
          planId: created.id,
          agentId: ag?.id ?? null,
          taskKey: t.taskKey,
          name: t.title,
          description: t.description,
          expectedOutput: t.expectedOutput,
          dependencies: stringifyJson(t.dependencies),
          status: 'pending',
        },
      });
    }
    return created;
  });

  await appendEvent({
    runId,
    type: 'plan.created',
    payload: {
      planId: planRow.id,
      taskCount: plan.tasks.length,
      rationale: plan.rationale,
    },
  });

  try {
    await exportPlanMd(run.project.slug, run.id, run.team.name, plan);
  } catch (err) {
    console.error('plan.md export failed:', err);
  }

  if (signal?.aborted) return;
  await prisma.run.update({ where: { id: runId }, data: { status: 'running' } });

  const taskRows = await prisma.task.findMany({
    where: { runId, planId: planRow.id },
    orderBy: { createdAt: 'asc' },
  });
  const taskNodes = taskRows.map((t) => ({
    id: t.id,
    taskKey: t.taskKey,
    agentId: t.agentId,
    title: t.name,
    description: t.description,
    expectedOutput: t.expectedOutput ?? '',
    dependencies: parseJson<string[]>(t.dependencies, []),
  }));

  let order: typeof taskNodes;
  try {
    order = topoSort(taskNodes);
  } catch (err) {
    const reason = `dag_invalid:${err instanceof Error ? err.name : 'unknown'}`;
    await markRunFailed(runId, reason);
    await appendEvent({
      runId,
      type: 'run.completed',
      payload: { success: false, succeededTasks: 0, failedTasks: 0, failedReason: reason },
    });
    return;
  }

  const taskResults = new Map<string, string>();
  let succeededTasks = 0;

  for (const t of order) {
    if (signal?.aborted) return; // stop before starting another task on cancel
    const outcome = await runOneTask({
      runId,
      userPrompt: run.prompt,
      agents: run.team.agents,
      taskNodes,
      taskResults,
      task: t,
      signal,
    });
    if (outcome === 'aborted') return; // cancel.ts owns the cancelled terminal state
    if (outcome === 'failed') {
      await markRunFailed(runId, `task_failed:${t.taskKey}`);
      await appendEvent({
        runId,
        type: 'run.completed',
        payload: {
          success: false,
          succeededTasks,
          failedTasks: 1,
          failedReason: `task_failed:${t.taskKey}`,
        },
      });
      return;
    }
    succeededTasks += 1;
  }

  // A cancel that landed after the last task finished must not flip to succeeded.
  if (signal?.aborted) return;

  await exportFinalResult({
    projectSlug: run.project.slug,
    runId,
    userPrompt: run.prompt,
    teamName: run.team.name,
    tasks: order.map((t) => {
      const agent = run.team!.agents.find((a) => a.id === t.agentId);
      return {
        taskKey: t.taskKey,
        title: t.title,
        agentName: agent?.name ?? 'Unknown agent',
        text: taskResults.get(t.taskKey) ?? '',
      };
    }),
  });

  await prisma.run.update({
    where: { id: runId },
    data: { status: 'succeeded', endedAt: new Date() },
  });
  await appendEvent({
    runId,
    type: 'run.completed',
    payload: { success: true, succeededTasks, failedTasks: 0 },
  });

  // Phase 5: best-effort report.md + agent-reports export. The result.md flow
  // above is unchanged; a failure here never affects run success.
  try {
    await exportRunReports(runId);
  } catch (err) {
    console.error('run reports export failed:', err);
  }
}

async function exportFinalResult(input: {
  projectSlug: string;
  runId: string;
  userPrompt: string;
  teamName: string;
  tasks: Array<{ taskKey: string; title: string; agentName: string; text: string }>;
}): Promise<void> {
  try {
    const markdown = buildFinalResultMarkdown({
      runId: input.runId,
      userPrompt: input.userPrompt,
      teamName: input.teamName,
      tasks: input.tasks,
    });
    const wrote = await exportRunResultMd({
      projectSlug: input.projectSlug,
      runId: input.runId,
      markdown,
    });
    const artifact = await prisma.artifact.create({
      data: {
        runId: input.runId,
        kind: 'result_md',
        path: wrote.path,
        mimeType: wrote.mimeType,
        bytes: wrote.bytes,
        sha256: wrote.sha256,
      },
      select: { id: true },
    });
    await appendEvent({
      runId: input.runId,
      type: 'result.created',
      artifactId: artifact.id,
      payload: {
        artifactId: artifact.id,
        path: wrote.path,
        bytes: wrote.bytes,
      },
    });
  } catch (err) {
    console.error('result.md export failed:', err);
  }
}

async function markRunFailed(runId: string, reason: string): Promise<void> {
  await prisma.run.update({
    where: { id: runId },
    data: { status: 'failed', failedReason: reason, endedAt: new Date() },
  });
}

async function markTaskFailed(
  runId: string,
  taskId: string,
  agentId: string | null,
  taskKey: string,
  reason: string,
  durationMs: number,
): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { status: 'failed', error: reason, completedAt: new Date() },
  });
  await appendEvent({
    runId,
    taskId,
    agentId,
    type: 'task.failed',
    payload: { taskKey, status: 'failed', error: reason, durationMs },
  });
}

// ---------------------------------------------------------------------------
// Single-task execution. Shared by the initial run loop (executeInner) and the
// Phase 8 resume loop (executeResume). Owns the task's own DB writes + events;
// the caller owns run-level success/failure transitions. Returns:
//   'done'    — task succeeded, result text recorded in taskResults
//   'failed'  — task.failed already written; caller marks the run failed
//   'aborted' — signal fired mid-task; cancel.ts owns the terminal state
// ---------------------------------------------------------------------------

interface ExecTaskNode {
  id: string;
  taskKey: string;
  agentId: string | null;
  title: string;
  description: string;
  expectedOutput: string;
  dependencies: string[];
}

interface ExecAgent {
  id: string;
  name: string;
  role: string;
  isLead: boolean;
  systemPrompt: string;
  modelId: string;
  provider: string;
}

interface RunOneTaskCtx {
  runId: string;
  userPrompt: string;
  agents: readonly ExecAgent[];
  taskNodes: readonly ExecTaskNode[];
  taskResults: Map<string, string>;
  task: ExecTaskNode;
  signal?: AbortSignal;
}

type RunOneTaskOutcome = 'done' | 'failed' | 'aborted';

async function runOneTask(ctx: RunOneTaskCtx): Promise<RunOneTaskOutcome> {
  const { runId, task: t, taskNodes, taskResults, agents, signal } = ctx;

  const ag = agents.find((a) => a.id === t.agentId);
  if (!ag) {
    await markTaskFailed(runId, t.id, null, t.taskKey, `agent_not_found:${t.taskKey}`, 0);
    return 'failed';
  }
  const provider = resolveProviderName(ag.provider);
  if (!provider) {
    await markTaskFailed(runId, t.id, ag.id, t.taskKey, `unknown_provider:${ag.provider}`, 0);
    return 'failed';
  }

  // Dependencies + their seeded results don't change between retry attempts.
  const upstream = t.dependencies
    .map((dep) => {
      const text = taskResults.get(dep);
      if (text == null) return null;
      const upTask = taskNodes.find((n) => n.taskKey === dep);
      const upAgent = upTask ? agents.find((a) => a.id === upTask.agentId) : null;
      return { taskKey: dep, agentName: upAgent?.name ?? 'unknown', text };
    })
    .filter((u): u is { taskKey: string; agentName: string; text: string } => u != null);

  // Phase 8 backoff: retry transient provider failures (rate_limit / timeout) in
  // place. Each attempt re-emits `task.started` so the UI output buffer resets and
  // the retried stream doesn't concatenate onto the previous attempt.
  let attempts = 0;
  while (true) {
    const taskStartedAt = Date.now();
    await prisma.task.update({
      where: { id: t.id },
      data: { status: 'running', startedAt: new Date() },
    });
    await appendEvent({
      runId,
      taskId: t.id,
      agentId: ag.id,
      type: 'task.started',
      payload: { taskKey: t.taskKey, agentName: ag.name, title: t.title },
    });

    try {
      const { text, bytes } = await runAgentTask({
        agent: {
          id: ag.id,
          name: ag.name,
          role: ag.role,
          systemPrompt: ag.systemPrompt,
          modelId: ag.modelId,
          provider,
        },
        task: {
          taskKey: t.taskKey,
          title: t.title,
          description: t.description,
          expectedOutput: t.expectedOutput,
          dependencies: t.dependencies,
        },
        upstreamResults: upstream,
        userPrompt: ctx.userPrompt,
        signal,
        onDelta: async (chunk) => {
          await appendEvent({
            runId,
            taskId: t.id,
            agentId: ag.id,
            type: 'agent.output.delta',
            payload: { taskKey: t.taskKey, text: chunk },
          });
        },
      });

      taskResults.set(t.taskKey, text);
      const durationMs = Date.now() - taskStartedAt;
      await prisma.task.update({
        where: { id: t.id },
        data: { status: 'done', result: stringifyJson({ text, bytes }), completedAt: new Date() },
      });
      await appendEvent({
        runId,
        taskId: t.id,
        agentId: ag.id,
        type: 'agent.output.completed',
        payload: { taskKey: t.taskKey, bytes },
      });
      await appendEvent({
        runId,
        taskId: t.id,
        agentId: ag.id,
        type: 'task.completed',
        payload: { taskKey: t.taskKey, status: 'done', durationMs },
      });
      return 'done';
    } catch (err) {
      if (signal?.aborted) return 'aborted'; // cancel.ts owns the cancelled terminal state
      attempts += 1;
      const classification = classifyGenerateError(err);
      const { kind, retryAfterMs } = classification;
      const decision = nextBackoff(kind, attempts, { retryAfterMs });
      if (decision.retry) {
        const delayMs = withJitter(decision.delayMs);
        await appendEvent({
          runId,
          taskId: t.id,
          agentId: ag.id,
          type: 'task.retry.attempt',
          payload: {
            taskKey: t.taskKey,
            attempt: attempts,
            kind,
            delayMs,
            ...(retryAfterMs != null ? { retryAfterMs } : {}),
          },
        });
        const abortedDuringWait = await abortableDelay(delayMs, signal);
        if (abortedDuringWait) return 'aborted';
        continue;
      }
      const durationMs = Date.now() - taskStartedAt;
      const errorMsg = redactString(err instanceof Error ? err.message : String(err)).slice(0, 240);
      await prisma.task.update({
        where: { id: t.id },
        data: { status: 'failed', error: errorMsg, completedAt: new Date() },
      });
      await appendEvent({
        runId,
        taskId: t.id,
        agentId: ag.id,
        type: 'task.failed',
        payload: { taskKey: t.taskKey, status: 'failed', error: errorMsg, durationMs },
      });
      return 'failed';
    }
  }
}

/**
 * Apply ±20% jitter to a backoff delay (spreads concurrent retries). Kept out of
 * the pure `nextBackoff` policy so the policy stays deterministic/testable; jitter
 * is a runtime-only concern applied right before sleeping.
 */
function withJitter(ms: number): number {
  if (ms <= 0) return ms;
  const factor = 1 + (Math.random() * 2 - 1) * 0.2;
  return Math.max(0, Math.round(ms * factor));
}

/** Sleep `ms`, resolving early to `true` if the signal aborts during the wait. */
function abortableDelay(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (ms <= 0) return Promise.resolve(signal?.aborted ?? false);
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(true);
      return;
    }
    const onAbort = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function mapPlanErrorReason(err: unknown): string {
  if (err instanceof LeadPlanInvalidError) return `lead_plan_invalid:${err.reason}`;
  if (err instanceof GenerateTimeoutError) return `lead_plan_timeout:${err.timeoutMs}ms`;
  if (err instanceof GenerateAbortedError) return 'lead_plan_aborted';
  if (err instanceof PoAuthError) return `lead_plan_provider_auth:${err.provider}`;
  if (err instanceof RateLimitError) return `lead_plan_rate_limit:${err.provider}`;
  if (err instanceof ModelNotFoundError) {
    return `lead_plan_model_not_found:${err.provider}`;
  }
  if (err instanceof ProviderUnavailableError) {
    return `lead_plan_provider_unavailable:${err.provider}`;
  }
  if (err instanceof PoSchemaError) return 'lead_plan_schema_error';
  if (err instanceof UnknownProviderError) return `lead_plan_unknown_provider:${err.provider}`;
  return `lead_plan_failed:${err instanceof Error ? err.message : String(err)}`;
}

interface ExportPlan {
  rationale: string;
  tasks: ExecutionPlanPayload['tasks'];
}

async function exportPlanMd(
  projectSlug: string,
  runId: string,
  teamName: string,
  plan: ExportPlan,
): Promise<void> {
  const root = workspaceRoot();
  const file = safeJoin(root, projectSlug, 'runs', runId, 'plan.md');
  const lines: string[] = [
    `# Run plan — ${teamName}`,
    '',
    '## Rationale',
    plan.rationale,
    '',
    `## Tasks (${plan.tasks.length})`,
    '',
    '| # | Task key | Agent | Title | Depends on |',
    '|---|---|---|---|---|',
    ...plan.tasks.map(
      (t, i) =>
        `| ${i + 1} | \`${t.taskKey}\` | ${t.assignedAgentName} | ${t.title} | ${
          t.dependencies.length
            ? t.dependencies.map((d) => `\`${d}\``).join(', ')
            : '—'
        } |`,
    ),
    '',
  ];
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, lines.join('\n'), 'utf8');
}
