import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import {
  proposeNewTeam,
  resolveModelHints,
  type ResolvedTeamProposal,
} from '@lib/agents/team';
import { poErrorResponse } from '@lib/agents/poErrorResponse';
import { listEnabledModels } from '@lib/models/catalog';
import { buildHistoryLines, loadSession } from '@lib/qa/sessionState';
import { recall, type RecalledTeamSummary } from '@lib/search/teamSearch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ModelCatalogClient {
  modelId: string;
  displayName: string;
  provider: string;
  costTier: string;
  speedTier: string;
  isDefault: boolean;
}

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
  const { sessionId } = body as { sessionId?: unknown };
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return NextResponse.json({ error: 'sessionId_required' }, { status: 400 });
  }

  const view = await loadSession(sessionId);
  if (!view) return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
  if (!view.isComplete) {
    return NextResponse.json({ error: 'session_not_completed' }, { status: 409 });
  }

  const run = await prisma.run.findUnique({
    where: { id: view.runId },
    select: { id: true, projectId: true, prompt: true, poModelId: true, teamId: true },
  });
  if (!run || !run.poModelId) {
    return NextResponse.json({ error: 'run_missing_model' }, { status: 500 });
  }
  if (run.teamId) {
    return NextResponse.json(
      { error: 'run_already_has_team', teamId: run.teamId },
      { status: 409 },
    );
  }

  const enabled = await listEnabledModels();
  const catalogForClient: ModelCatalogClient[] = enabled.map((m) => ({
    modelId: m.modelId,
    displayName: m.displayName,
    provider: m.provider,
    costTier: m.costTier,
    speedTier: m.speedTier,
    isDefault: m.isDefault,
  }));

  const historyLines = buildHistoryLines(view);

  let recalled: RecalledTeamSummary[] = [];
  try {
    recalled = await recall({
      projectId: run.projectId,
      prompt: run.prompt,
      historyLines,
    });
  } catch (err) {
    console.error('teamSearch.recall failed:', err);
  }

  let proposal: ResolvedTeamProposal;
  try {
    const raw = await proposeNewTeam({
      modelId: run.poModelId,
      userPrompt: run.prompt,
      historyLines,
      signal: request.signal,
    });
    proposal = resolveModelHints(raw, enabled, run.poModelId);
  } catch (err) {
    return poErrorResponse(err, 'team_recommend_failed');
  }

  return NextResponse.json({
    recalled,
    proposal,
    modelCatalog: catalogForClient,
  });
}
