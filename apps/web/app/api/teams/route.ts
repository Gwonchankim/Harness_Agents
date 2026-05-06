import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { stringifyJson } from '@lib/db/json';
import {
  getEnabledModelOrThrow,
  ModelDisabledError,
  resolveProviderName,
} from '@lib/models/catalog';
import { ALLOWED_TOOL_NAMES } from '@lib/tools/policy';
import { TEAM_AGENT_COUNT } from '@lib/agents/team';
import { buildSnapshot, type SerializableAgent } from '@lib/team/serialize';
import { exportTeamFiles } from '@lib/workspace/exportService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ConfirmedAgentBody {
  name?: unknown;
  role?: unknown;
  isLead?: unknown;
  modelId?: unknown;
  systemPrompt?: unknown;
  toolsAllowed?: unknown;
  tags?: unknown;
}

interface ConfirmedProposalBody {
  name?: unknown;
  description?: unknown;
  domain?: unknown;
  tags?: unknown;
  agents?: unknown;
}

const allowlistSet = new Set<string>(ALLOWED_TOOL_NAMES);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { sessionId, choice, recalledTeamId, proposal } = body as {
    sessionId?: unknown;
    choice?: unknown;
    recalledTeamId?: unknown;
    proposal?: unknown;
  };
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return NextResponse.json({ error: 'sessionId_required' }, { status: 400 });
  }
  if (choice !== 'new' && choice !== 'recalled') {
    return NextResponse.json({ error: 'choice_required' }, { status: 400 });
  }

  const session = await prisma.qaSession.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, runId: true },
  });
  if (!session) {
    return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
  }
  if (session.status !== 'completed') {
    return NextResponse.json({ error: 'session_not_completed' }, { status: 409 });
  }

  const run = await prisma.run.findUnique({
    where: { id: session.runId },
    select: { id: true, projectId: true, teamId: true, project: { select: { slug: true } } },
  });
  if (!run) return NextResponse.json({ error: 'run_not_found' }, { status: 404 });
  if (run.teamId) {
    return NextResponse.json(
      { error: 'run_already_has_team', teamId: run.teamId, runId: run.id },
      { status: 409 },
    );
  }

  if (choice === 'recalled') {
    if (typeof recalledTeamId !== 'string' || recalledTeamId.length === 0) {
      return NextResponse.json({ error: 'recalledTeamId_required' }, { status: 400 });
    }
    const team = await prisma.team.findFirst({
      where: { id: recalledTeamId, projectId: run.projectId, status: 'active' },
      select: { id: true },
    });
    if (!team) {
      return NextResponse.json({ error: 'recalled_team_not_found' }, { status: 404 });
    }
    await prisma.run.update({
      where: { id: run.id },
      data: { teamId: team.id, status: 'ready' },
    });
    return NextResponse.json({ ok: true, teamId: team.id, runId: run.id });
  }

  const validated = await validateNewProposal(proposal);
  if ('error' in validated) {
    return NextResponse.json(validated, { status: validated.status ?? 400 });
  }

  const { team: teamInput, agents: agentInputs } = validated;
  const snapshot = buildSnapshot(teamInput, agentInputs);

  let createdTeamId: string;
  try {
    createdTeamId = await prisma.$transaction(async (tx) => {
      const createdTeam = await tx.team.create({
        data: {
          projectId: run.projectId,
          name: teamInput.name,
          description: teamInput.description ?? null,
          domain: teamInput.domain ?? null,
          tags: stringifyJson(teamInput.tags),
          status: 'active',
        },
        select: { id: true },
      });

      const createdAgents = await Promise.all(
        agentInputs.map((a) =>
          tx.agent.create({
            data: {
              teamId: createdTeam.id,
              name: a.name,
              role: a.role,
              isLead: a.isLead,
              systemPrompt: a.systemPrompt,
              modelId: a.modelId,
              provider: a.provider,
              toolsAllowed: stringifyJson(a.toolsAllowed),
              tags: stringifyJson(a.tags),
            },
            select: { id: true, name: true, isLead: true },
          }),
        ),
      );
      const lead = createdAgents.find((c) => c.isLead);
      if (!lead) {
        throw new Error('exactly_one_lead_invariant_failed');
      }

      const revision = await tx.teamRevision.create({
        data: {
          teamId: createdTeam.id,
          version: 1,
          agentsSnapshot: stringifyJson({
            team: teamInput,
            agents: agentInputs,
          }),
          agentsMd: snapshot.agentsMd,
          teamJson: snapshot.teamJson,
          proposedBy: 'po',
          approvedBy: 'user',
          sourceRunId: run.id,
          reason: 'initial team proposal',
          approvedAt: new Date(),
        },
        select: { id: true },
      });

      await tx.team.update({
        where: { id: createdTeam.id },
        data: {
          leadAgentId: lead.id,
          currentRevisionId: revision.id,
        },
      });

      await tx.run.update({
        where: { id: run.id },
        data: { teamId: createdTeam.id, status: 'ready' },
      });

      return createdTeam.id;
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: 'team_create_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }

  // Best-effort export. DB is already canonical.
  const exportResult = await exportTeamFiles({
    projectSlug: run.project.slug,
    teamId: createdTeamId,
    agentsMd: snapshot.agentsMd,
    teamJson: snapshot.teamJson,
  });

  if (exportResult.wrote.length > 0) {
    await prisma.$transaction(
      exportResult.wrote.map((w) =>
        prisma.artifact.create({
          data: {
            runId: run.id,
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

  return NextResponse.json({
    ok: true,
    teamId: createdTeamId,
    runId: run.id,
    exportErrors: exportResult.errors.length > 0 ? exportResult.errors : undefined,
  });
}

interface ValidatedProposal {
  team: {
    name: string;
    description: string | null;
    domain: string | null;
    tags: string[];
  };
  agents: SerializableAgent[];
}

interface ValidationFailure {
  error: string;
  status?: number;
  detail?: unknown;
}

async function validateNewProposal(
  raw: unknown,
): Promise<ValidatedProposal | ValidationFailure> {
  if (typeof raw !== 'object' || raw === null) {
    return { error: 'proposal_required' };
  }
  const body = raw as ConfirmedProposalBody;
  if (typeof body.name !== 'string' || body.name.length === 0) {
    return { error: 'proposal_name_required' };
  }
  if (!Array.isArray(body.agents) || body.agents.length !== TEAM_AGENT_COUNT) {
    return { error: 'proposal_agent_count' };
  }

  const validatedAgents: SerializableAgent[] = [];
  let leadCount = 0;
  for (const a of body.agents as ConfirmedAgentBody[]) {
    if (
      typeof a.name !== 'string' ||
      typeof a.role !== 'string' ||
      typeof a.isLead !== 'boolean' ||
      typeof a.modelId !== 'string' ||
      typeof a.systemPrompt !== 'string'
    ) {
      return { error: 'agent_field_required' };
    }
    if (!Array.isArray(a.toolsAllowed)) {
      return { error: 'agent_toolsAllowed_required' };
    }
    for (const t of a.toolsAllowed) {
      if (typeof t !== 'string' || !allowlistSet.has(t)) {
        return { error: 'agent_tool_not_in_allowlist' };
      }
    }
    let modelRow;
    try {
      modelRow = await getEnabledModelOrThrow(a.modelId);
    } catch (err) {
      if (err instanceof ModelDisabledError) {
        return { error: 'agent_model_disabled', status: 409 };
      }
      return { error: 'agent_model_unknown', status: 400 };
    }
    const provider = resolveProviderName(modelRow.provider);
    if (!provider) {
      return { error: 'agent_provider_unknown', status: 500 };
    }
    if (a.isLead) leadCount += 1;
    const agentTags = Array.isArray(a.tags)
      ? (a.tags as unknown[]).filter((v): v is string => typeof v === 'string')
      : [];
    validatedAgents.push({
      name: a.name,
      role: a.role,
      isLead: a.isLead,
      modelId: modelRow.modelId,
      provider,
      systemPrompt: a.systemPrompt,
      toolsAllowed: a.toolsAllowed.filter((v): v is string => typeof v === 'string'),
      tags: agentTags,
    });
  }
  if (leadCount !== 1) {
    return { error: 'exactly_one_lead_required' };
  }

  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  return {
    team: {
      name: body.name,
      description: typeof body.description === 'string' ? body.description : null,
      domain: typeof body.domain === 'string' ? body.domain : null,
      tags,
    },
    agents: validatedAgents,
  };
}
