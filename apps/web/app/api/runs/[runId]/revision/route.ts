// POST /api/runs/[runId]/revision — dispatches the revision lifecycle:
//   action=propose  → Lead generates an improved team + diff (no DB revision yet)
//   action=approve  → create TeamRevision v(N+1) (requires matching baseRevisionId)
//   action=reject   → log the decision only
// Thin handler: all domain logic lives in lib/revision/*.

import { NextResponse } from 'next/server';

import { PoAuthError, PoSchemaError, ProviderUnavailableError } from '@lib/agents/po';
import { UnknownProviderError } from '@lib/models/catalog';
import { GenerateAbortedError, GenerateTimeoutError } from '@lib/qa/timeout';
import { approveRevision, RevisionApproveError, RevisionStaleError } from '@lib/revision/approve';
import { proposeRevision, RevisionContextError } from '@lib/revision/propose';
import { rejectRevision } from '@lib/revision/reject';
import { RevisionValidationError } from '@lib/revision/validate';
import { ensureRecovered } from '@lib/runtime/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: Promise<{ runId: string }> },
) {
  await ensureRecovered();
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
  const { action } = body as { action?: unknown };
  if (action !== 'propose' && action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'invalid_action' }, { status: 400 });
  }

  try {
    if (action === 'propose') {
      const result = await proposeRevision(runId);
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === 'approve') {
      const { baseRevisionId, feedbackBatchId, proposedSpec } = body as {
        baseRevisionId?: unknown;
        feedbackBatchId?: unknown;
        proposedSpec?: unknown;
      };
      if (typeof baseRevisionId !== 'string' || baseRevisionId.length === 0) {
        return NextResponse.json({ error: 'baseRevisionId_required' }, { status: 400 });
      }
      const result = await approveRevision({
        runId,
        baseRevisionId,
        feedbackBatchId: typeof feedbackBatchId === 'string' ? feedbackBatchId : null,
        proposedSpec,
      });
      return NextResponse.json({ ok: true, ...result });
    }

    const { baseRevisionId } = body as { baseRevisionId?: unknown };
    await rejectRevision(runId, typeof baseRevisionId === 'string' ? baseRevisionId : null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return mapRevisionError(err);
  }
}

function mapRevisionError(err: unknown): NextResponse {
  if (err instanceof RevisionStaleError) {
    return NextResponse.json({ error: 'revision_stale' }, { status: 409 });
  }
  if (err instanceof RevisionValidationError) {
    return NextResponse.json({ error: err.reason }, { status: 400 });
  }
  if (err instanceof RevisionApproveError) {
    const status = err.reason === 'run_not_found' ? 404 : 409;
    return NextResponse.json({ error: err.reason }, { status });
  }
  if (err instanceof RevisionContextError) {
    return NextResponse.json({ error: err.reason }, { status: 409 });
  }
  if (err instanceof GenerateTimeoutError) {
    return NextResponse.json(
      { error: 'lead_revise_timeout', provider: err.provider, modelId: err.modelId },
      { status: 504 },
    );
  }
  if (err instanceof GenerateAbortedError) {
    return NextResponse.json({ error: 'lead_revise_aborted' }, { status: 408 });
  }
  if (err instanceof PoAuthError) {
    return NextResponse.json(
      { error: 'lead_revise_provider_auth', provider: err.provider },
      { status: 502 },
    );
  }
  if (err instanceof ProviderUnavailableError) {
    return NextResponse.json(
      { error: 'lead_revise_provider_unavailable', provider: err.provider },
      { status: 503 },
    );
  }
  if (err instanceof PoSchemaError) {
    return NextResponse.json({ error: 'lead_revise_schema_error' }, { status: 502 });
  }
  if (err instanceof UnknownProviderError) {
    return NextResponse.json(
      { error: 'lead_revise_unknown_provider', provider: err.provider },
      { status: 500 },
    );
  }
  return NextResponse.json(
    { error: 'lead_revise_failed', message: err instanceof Error ? err.message : String(err) },
    { status: 500 },
  );
}
