// Route-side mapping: typed agent/generation errors → HTTP status + body.
//
// Shared by the routes that drive PO Q&A + team proposal generation
// (qa/[sessionId]/next, qa/[sessionId]/answer, teams/recommend), which all used
// an identical copy of `mapPoError`. The revision route is intentionally NOT
// consolidated here: it has a different response contract (e.g. aborted → 408,
// provider auth → 502) and revision-specific errors, so unifying it would change
// its public contract and risk the Phase 5/6 revision flow.
//
// `poErrorPayload` is a pure function (no next/server import) so it is cheap to
// unit-test; `poErrorResponse` is the thin wrapper that returns a standard
// Response (Next.js route handlers accept a plain Response).

import { ModelDisabledError, UnknownProviderError } from '@lib/models/catalog';
import { GenerateAbortedError, GenerateTimeoutError } from '@lib/qa/timeout';

import {
  ModelNotFoundError,
  PoAuthError,
  PoSchemaError,
  ProviderUnavailableError,
  RateLimitError,
} from './po';

export interface PoErrorPayload {
  status: number;
  body: Record<string, unknown>;
}

/** Pure typed-error → { status, body } mapping. */
export function poErrorPayload(
  err: unknown,
  fallbackCode = 'generation_failed',
): PoErrorPayload {
  if (err instanceof GenerateAbortedError) {
    return { status: 499, body: { error: 'aborted' } };
  }
  if (err instanceof GenerateTimeoutError) {
    return {
      status: 504,
      body: {
        error: 'timeout',
        timeoutMs: err.timeoutMs,
        provider: err.provider,
        modelId: err.modelId,
      },
    };
  }
  if (err instanceof PoAuthError) {
    return {
      status: 401,
      body: { error: 'provider_auth_failed', provider: err.provider, status: err.status },
    };
  }
  if (err instanceof RateLimitError) {
    return { status: 429, body: { error: 'rate_limit', provider: err.provider } };
  }
  if (err instanceof ModelNotFoundError) {
    return {
      status: 404,
      body: { error: 'model_not_found', provider: err.provider, modelId: err.modelId },
    };
  }
  if (err instanceof ProviderUnavailableError) {
    return {
      status: 503,
      body: { error: 'provider_unavailable', provider: err.provider, reason: err.reason },
    };
  }
  if (err instanceof PoSchemaError) {
    return { status: 502, body: { error: 'po_schema_error' } };
  }
  if (err instanceof UnknownProviderError) {
    return { status: 500, body: { error: 'unknown_provider', provider: err.provider } };
  }
  if (err instanceof ModelDisabledError) {
    return { status: 409, body: { error: 'model_disabled', modelId: err.modelId } };
  }
  return {
    status: 500,
    body: { error: fallbackCode, message: err instanceof Error ? err.message : String(err) },
  };
}

/** Wrapper returning a standard Response for use directly in route handlers. */
export function poErrorResponse(err: unknown, fallbackCode = 'generation_failed'): Response {
  const { status, body } = poErrorPayload(err, fallbackCode);
  return Response.json(body, { status });
}
