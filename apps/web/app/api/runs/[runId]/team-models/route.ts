import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import {
  getEnabledModelOrThrow,
  ModelDisabledError,
  resolveProviderName,
} from '@lib/models/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AgentModelInput {
  agentId?: unknown;
  modelId?: unknown;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  const { runId } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const agentsInput = (body as { agents?: unknown }).agents;
  if (!Array.isArray(agentsInput) || agentsInput.length === 0) {
    return NextResponse.json({ error: 'agents_required' }, { status: 400 });
  }

  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      failedReason: true,
      teamId: true,
      team: {
        select: {
          agents: {
            select: { id: true },
          },
        },
      },
    },
  });
  if (!run) return NextResponse.json({ error: 'run_not_found' }, { status: 404 });
  if (!run.teamId || !run.team) {
    return NextResponse.json({ error: 'run_has_no_team' }, { status: 409 });
  }
  const teamId = run.teamId;
  if (run.status !== 'ready' && run.status !== 'failed') {
    return NextResponse.json(
      { error: 'run_not_editable', status: run.status },
      { status: 409 },
    );
  }

  const teamAgentIds = new Set(run.team.agents.map((a) => a.id));
  const updates: Array<{ agentId: string; modelId: string; provider: string }> = [];
  for (const raw of agentsInput as AgentModelInput[]) {
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof raw.agentId !== 'string' ||
      typeof raw.modelId !== 'string'
    ) {
      return NextResponse.json({ error: 'agent_model_field_required' }, { status: 400 });
    }
    if (!teamAgentIds.has(raw.agentId)) {
      return NextResponse.json({ error: 'agent_not_in_run_team' }, { status: 400 });
    }
    let modelRow;
    try {
      modelRow = await getEnabledModelOrThrow(raw.modelId);
    } catch (err) {
      if (err instanceof ModelDisabledError) {
        return NextResponse.json(
          { error: 'model_disabled', modelId: raw.modelId },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: 'model_unknown', modelId: raw.modelId },
        { status: 400 },
      );
    }
    const provider = resolveProviderName(modelRow.provider);
    if (!provider) {
      return NextResponse.json(
        { error: 'provider_unknown', provider: modelRow.provider },
        { status: 500 },
      );
    }
    updates.push({ agentId: raw.agentId, modelId: modelRow.modelId, provider });
  }

  const canResetFailedRun =
    run.status === 'failed' &&
    (run.failedReason?.startsWith('lead_plan_provider_unavailable:') ||
      run.failedReason?.startsWith('lead_plan_provider_auth:') ||
      run.failedReason?.startsWith('lead_plan_unknown_provider:') ||
      run.failedReason === 'lead_plan_schema_error' ||
      run.failedReason?.startsWith('lead_plan_model_not_found:') ||
      run.failedReason?.startsWith('lead_plan_timeout:'));

  const result = await prisma.$transaction(async (tx) => {
    for (const update of updates) {
      await tx.agent.update({
        where: { id: update.agentId },
        data: { modelId: update.modelId, provider: update.provider },
      });
    }
    if (canResetFailedRun) {
      await tx.run.update({
        where: { id: run.id },
        data: {
          status: 'ready',
          failedReason: null,
          startedAt: null,
          endedAt: null,
        },
      });
    }
    const agents = await tx.agent.findMany({
      where: { teamId },
      orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        role: true,
        isLead: true,
        provider: true,
        modelId: true,
      },
    });
    return {
      agents,
      status: canResetFailedRun ? 'ready' : run.status,
      failedReason: canResetFailedRun ? null : run.failedReason,
      resetToReady: canResetFailedRun,
    };
  });

  return NextResponse.json({ ok: true, ...result });
}
