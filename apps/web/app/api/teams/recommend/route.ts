import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import {
  proposeNewTeam,
  resolveModelHints,
  type ResolvedTeamProposal,
} from '@lib/agents/team';
import { PoAuthError, PoSchemaError, ProviderUnavailableError } from '@lib/agents/po';
import {
  ModelDisabledError,
  UnknownProviderError,
  listEnabledModels,
} from '@lib/models/catalog';
import { GenerateAbortedError, GenerateTimeoutError } from '@lib/qa/timeout';
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
    return mapPoError(err);
  }

  return NextResponse.json({
    recalled,
    proposal,
    modelCatalog: catalogForClient,
  });
}

function mapPoError(err: unknown) {
  if (err instanceof GenerateAbortedError) {
    return NextResponse.json({ error: 'aborted' }, { status: 499 });
  }
  if (err instanceof GenerateTimeoutError) {
    return NextResponse.json({ error: 'timeout', timeoutMs: err.timeoutMs }, { status: 504 });
  }
  if (err instanceof ProviderUnavailableError) {
    return NextResponse.json(
      { error: 'provider_unavailable', provider: err.provider, reason: err.reason },
      { status: 503 },
    );
  }
  if (err instanceof PoAuthError) {
    return NextResponse.json(
      { error: 'provider_auth_failed', provider: err.provider, status: err.status },
      { status: 401 },
    );
  }
  if (err instanceof PoSchemaError) {
    return NextResponse.json({ error: 'po_schema_error' }, { status: 502 });
  }
  if (err instanceof UnknownProviderError) {
    return NextResponse.json(
      { error: 'unknown_provider', provider: err.provider },
      { status: 500 },
    );
  }
  if (err instanceof ModelDisabledError) {
    return NextResponse.json(
      { error: 'model_disabled', modelId: err.modelId },
      { status: 409 },
    );
  }
  return NextResponse.json(
    { error: 'team_recommend_failed', message: err instanceof Error ? err.message : String(err) },
    { status: 500 },
  );
}
