// Revision approve. Creates TeamRevision v(N+1) ONLY here. Updates the existing
// agents by agentId (never deletes/creates rows — Task/Feedback/AgentRating/
// RunEvent FKs stay valid), preserves all prior revisions, and flips
// Team.currentRevisionId. Rejects stale approvals (baseRevisionId mismatch).

import { prisma } from '@db/client';
import { parseStringArray, stringifyJson } from '@lib/db/json';

import { appendEvent } from '@lib/events/append';
import { createApprovedRevision, nextRevisionVersion } from '@lib/team/revision';
import { buildSnapshot, type SerializableAgent } from '@lib/team/serialize';
import { exportTeamFiles } from '@lib/workspace/exportService';

import { validateRevisionProposal } from './validate';

export class RevisionStaleError extends Error {
  constructor() {
    super('revision_stale');
    this.name = 'RevisionStaleError';
  }
}

export class RevisionApproveError extends Error {
  constructor(public readonly reason: string) {
    super(`revision_approve_error: ${reason}`);
    this.name = 'RevisionApproveError';
  }
}

export interface ApproveRevisionInput {
  runId: string;
  baseRevisionId: string;
  feedbackBatchId: string | null;
  proposedSpec: unknown;
}

export interface ApproveRevisionResult {
  revisionId: string;
  version: number;
  teamId: string;
  paths: {
    agentsMd: string;
    teamJson: string;
  };
  exportedPaths: string[];
}

export async function approveRevision(input: ApproveRevisionInput): Promise<ApproveRevisionResult> {
  const run = await prisma.run.findUnique({
    where: { id: input.runId },
    select: {
      id: true,
      status: true,
      project: { select: { slug: true } },
      team: {
        select: {
          id: true,
          name: true,
          description: true,
          domain: true,
          tags: true,
          currentRevisionId: true,
          agents: {
            select: { id: true, modelId: true, provider: true },
          },
        },
      },
    },
  });
  if (!run) throw new RevisionApproveError('run_not_found');
  if (!run.team) throw new RevisionApproveError('run_has_no_team');
  if (run.status !== 'succeeded') throw new RevisionApproveError('run_not_succeeded');

  const team = run.team;
  if (team.currentRevisionId !== input.baseRevisionId) throw new RevisionStaleError();

  const spec = validateRevisionProposal(
    input.proposedSpec,
    team.agents.map((a) => a.id),
  );

  const existingById = new Map(team.agents.map((a) => [a.id, a] as const));
  const teamMeta = {
    name: team.name,
    description: spec.teamDescription ?? team.description,
    domain: team.domain,
    tags: parseStringArray(team.tags),
  };
  const afterAgents: SerializableAgent[] = spec.agents.map((pa) => {
    const existing = existingById.get(pa.agentId)!;
    return {
      name: pa.name,
      role: pa.role,
      isLead: pa.isLead,
      modelId: existing.modelId,
      provider: existing.provider,
      systemPrompt: pa.systemPrompt,
      toolsAllowed: pa.toolsAllowed,
      tags: pa.tags,
    };
  });
  const snapshot = buildSnapshot(teamMeta, afterAgents);
  const leadAgentId = spec.agents.find((a) => a.isLead)!.agentId;

  const rev = await prisma.$transaction(async (tx) => {
    // Re-check inside the transaction so a concurrent approve can't double-apply.
    const fresh = await tx.team.findUnique({
      where: { id: team.id },
      select: { currentRevisionId: true },
    });
    if (!fresh || fresh.currentRevisionId !== input.baseRevisionId) {
      throw new RevisionStaleError();
    }

    for (const pa of spec.agents) {
      await tx.agent.update({
        where: { id: pa.agentId },
        data: {
          name: pa.name,
          role: pa.role,
          isLead: pa.isLead,
          systemPrompt: pa.systemPrompt,
          toolsAllowed: stringifyJson(pa.toolsAllowed),
          tags: stringifyJson(pa.tags),
        },
      });
    }

    await tx.team.update({
      where: { id: team.id },
      data: { description: teamMeta.description ?? null, leadAgentId },
    });

    const version = await nextRevisionVersion(tx, team.id);
    const created = await createApprovedRevision(tx, {
      teamId: team.id,
      version,
      agentsSnapshot: stringifyJson({ team: teamMeta, agents: afterAgents }),
      agentsMd: snapshot.agentsMd,
      teamJson: snapshot.teamJson,
      proposedBy: 'lead',
      approvedBy: 'user',
      sourceRunId: input.runId,
      feedbackBatchId: input.feedbackBatchId,
      reason: spec.rationale,
    });

    await tx.team.update({
      where: { id: team.id },
      data: { currentRevisionId: created.id },
    });

    return created;
  });

  // Best-effort re-export. DB is already canonical.
  let exportedPaths: string[] = [];
  try {
    const exported = await exportTeamFiles({
      projectSlug: run.project.slug,
      teamId: team.id,
      agentsMd: snapshot.agentsMd,
      teamJson: snapshot.teamJson,
    });
    exportedPaths = exported.wrote.map((w) => w.path);
    if (exported.wrote.length > 0) {
      await prisma.$transaction(
        exported.wrote.map((w) =>
          prisma.artifact.create({
            data: {
              runId: input.runId,
              kind: w.kind,
              path: w.path,
              mimeType: w.mimeType,
              bytes: w.bytes,
              sha256: w.sha256,
            },
          }),
        ),
      );
    }
  } catch (err) {
    console.error('team re-export failed:', err);
  }

  await appendEvent({
    runId: input.runId,
    type: 'revision.approved',
    payload: { revisionId: rev.id, version: rev.version },
  });

  return {
    revisionId: rev.id,
    version: rev.version,
    teamId: team.id,
    paths: {
      agentsMd: `projects/${run.project.slug}/teams/${team.id}/AGENTS.md`,
      teamJson: `projects/${run.project.slug}/teams/${team.id}/team.json`,
    },
    exportedPaths,
  };
}
