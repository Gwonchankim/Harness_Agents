// Report exporter. Writes report.md + agent-reports/{agentId}.md for a completed
// run and records Artifact rows. Called best-effort from the DAG executor AFTER
// the existing result.md export (Phase 4 flow stays untouched). Re-queries the DB
// so it stays decoupled from executor internals; DB is the source of truth.

import { prisma } from '@db/client';
import { parseJson } from '@lib/db/json';

import { writeWorkspaceFile } from '@lib/workspace/writeWorkspaceFile';

import { buildRunReportMarkdown, type ReportTaskInput } from './report';
import { buildAgentReportMarkdown, type AgentReportTaskInput } from './agentReport';
import type { AttemptSummaryRow } from './attemptSummary';

export async function exportRunReports(runId: string): Promise<void> {
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      prompt: true,
      status: true,
      startedAt: true,
      endedAt: true,
      project: { select: { slug: true } },
      team: {
        select: {
          name: true,
          agents: {
            select: {
              id: true,
              name: true,
              role: true,
              isLead: true,
              modelId: true,
              provider: true,
              createdAt: true,
            },
            orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
          },
        },
      },
      plan: { select: { rationale: true } },
      tasks: {
        select: {
          id: true,
          taskKey: true,
          name: true,
          description: true,
          expectedOutput: true,
          status: true,
          agentId: true,
          startedAt: true,
          completedAt: true,
          result: true,
          error: true,
          // Phase 14: per-attempt summary. resultText is intentionally NOT selected
          // (size + redactor-free trust boundary); reports show summary only.
          attempts: {
            select: {
              attemptNumber: true,
              status: true,
              source: true,
              resultBytes: true,
              error: true,
              startedAt: true,
              completedAt: true,
            },
            orderBy: { attemptNumber: 'asc' },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!run || !run.team) return;

  const slug = run.project.slug;
  const agents = run.team.agents;
  const agentById = new Map(agents.map((a) => [a.id, a] as const));

  const reportTasks: ReportTaskInput[] = run.tasks.map((t) => {
    const parsed = t.result ? parseJson<{ bytes?: number }>(t.result, {}) : {};
    return {
      taskKey: t.taskKey,
      title: t.name,
      agentName: t.agentId ? (agentById.get(t.agentId)?.name ?? 'Unknown agent') : 'Unknown agent',
      status: t.status,
      durationMs: durationMs(t.startedAt, t.completedAt),
      outputBytes: typeof parsed.bytes === 'number' ? parsed.bytes : null,
      error: t.error,
      attempts: mapAttempts(t.attempts),
    };
  });

  const reportMd = buildRunReportMarkdown({
    runId: run.id,
    userPrompt: run.prompt,
    teamName: run.team.name,
    status: run.status,
    rationale: run.plan?.rationale ?? null,
    agents: agents.map((a) => ({
      name: a.name,
      role: a.role,
      modelId: a.modelId,
      provider: a.provider,
      isLead: a.isLead,
    })),
    tasks: reportTasks,
    startedAt: run.startedAt?.toISOString() ?? null,
    endedAt: run.endedAt?.toISOString() ?? null,
  });

  await writeArtifact(run.id, [slug, 'runs', run.id, 'report.md'], reportMd, 'report_md');

  const tasksByAgent = new Map<string, typeof run.tasks>();
  for (const t of run.tasks) {
    if (!t.agentId) continue;
    const arr = tasksByAgent.get(t.agentId) ?? [];
    arr.push(t);
    tasksByAgent.set(t.agentId, arr);
  }

  for (const [agentId, tasks] of tasksByAgent) {
    const agent = agentById.get(agentId);
    if (!agent) continue;
    const md = buildAgentReportMarkdown({
      agentId,
      agentName: agent.name,
      role: agent.role,
      modelId: agent.modelId,
      provider: agent.provider,
      isLead: agent.isLead,
      tasks: tasks.map((t): AgentReportTaskInput => {
        const parsed = t.result ? parseJson<{ text?: string }>(t.result, {}) : {};
        return {
          taskKey: t.taskKey,
          title: t.name,
          description: t.description,
          expectedOutput: t.expectedOutput,
          status: t.status,
          durationMs: durationMs(t.startedAt, t.completedAt),
          text: parsed.text ?? '',
          error: t.error,
          attempts: mapAttempts(t.attempts),
        };
      }),
    });
    await writeArtifact(
      run.id,
      [slug, 'runs', run.id, 'agent-reports', `${agentId}.md`],
      md,
      'agent_report_md',
    );
  }
}

async function writeArtifact(
  runId: string,
  relParts: string[],
  content: string,
  kind: string,
): Promise<void> {
  try {
    const wrote = await writeWorkspaceFile(relParts, content, 'text/markdown');
    await prisma.artifact.create({
      data: {
        runId,
        kind,
        path: wrote.path,
        mimeType: wrote.mimeType,
        bytes: wrote.bytes,
        sha256: wrote.sha256,
      },
    });
  } catch (err) {
    console.error(`${kind} export failed:`, err);
  }
}

function durationMs(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const ms = end.getTime() - start.getTime();
  return ms >= 0 ? ms : null;
}

function mapAttempts(
  rows: {
    attemptNumber: number;
    status: string;
    source: string;
    resultBytes: number | null;
    error: string | null;
    startedAt: Date;
    completedAt: Date | null;
  }[],
): AttemptSummaryRow[] {
  return rows.map((a) => ({
    attemptNumber: a.attemptNumber,
    status: a.status,
    source: a.source,
    durationMs: durationMs(a.startedAt, a.completedAt),
    resultBytes: a.resultBytes,
    error: a.error,
  }));
}
