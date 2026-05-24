// Shared provider-error classification for agent generate/stream calls.
//
// Pure leaf module: depends only on the two control-flow errors from the Phase 2
// timeout helper. It never imports the typed error classes (those live in po.ts)
// or any heavy runtime (AI SDK / Prisma), so it stays cheaply unit-testable.
//
// The four generation callers (po / lead / team / leadRevise) and the worker all
// route raw SDK errors through `classifyGenerateError`; po.ts's `raiseProviderError`
// maps the resulting kind to the concrete typed error to throw. This replaces the
// `extractAuthStatus` + `looksLikeSchemaError` + catch-chain that was previously
// copy-pasted across five files (and incomplete in the worker).

import { GenerateAbortedError, GenerateTimeoutError } from '@lib/qa/timeout';

export type GenerateErrorKind =
  | 'abort'
  | 'timeout'
  | 'auth'
  | 'rate_limit'
  | 'model_not_found'
  | 'schema'
  | 'provider_unavailable';

export interface GenerateErrorClassification {
  kind: GenerateErrorKind;
  /** HTTP-ish status when one could be extracted (401 / 403 / 404 / 429). */
  status?: number;
}

/**
 * Pull a numeric status off an SDK error — from a `statusCode`/`status` field, or
 * from well-known tokens in the message. Conservative on message parsing: only
 * the explicit status numbers and `unauthorized`/`forbidden`/`too many requests`.
 * Returns null when nothing usable is present.
 */
export function extractProviderErrorStatus(err: unknown): number | null {
  const candidate =
    err && typeof err === 'object'
      ? ((err as { statusCode?: unknown; status?: unknown }).statusCode ??
        (err as { status?: unknown }).status)
      : undefined;
  if (typeof candidate === 'number') return candidate;
  if (err instanceof Error) {
    const m = err.message;
    if (/\b401\b|unauthorized/i.test(m)) return 401;
    if (/\b403\b|forbidden/i.test(m)) return 403;
    if (/\b404\b/.test(m)) return 404;
    if (/\b429\b|too many requests/i.test(m)) return 429;
  }
  return null;
}

export function looksLikeRateLimit(err: unknown): boolean {
  if (extractProviderErrorStatus(err) === 429) return true;
  return err instanceof Error && /rate.?limit|too many requests|quota exceeded/i.test(err.message);
}

export function looksLikeModelNotFound(err: unknown): boolean {
  if (extractProviderErrorStatus(err) === 404) return true;
  return (
    err instanceof Error &&
    /model.*(not found|not_found|does not exist)|unknown model|no such model/i.test(err.message)
  );
}

export function looksLikeSchemaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'AI_NoObjectGeneratedError' ||
    err.name === 'NoObjectGeneratedError' ||
    /no object generated|invalid object|zod/i.test(err.message)
  );
}

/**
 * Classify a raw error from a generate/stream call. Our own control-flow errors
 * (GenerateAbortedError / GenerateTimeoutError) pass through as `abort` / `timeout`;
 * raw SDK abort errors are NOT treated as `abort` here (the worker uses a local
 * AbortController for its wall-clock timeout, so a raw abort there means timeout,
 * not user cancel — user cancel is detected via the run-level signal in the
 * executor, not via the error kind).
 */
export function classifyGenerateError(err: unknown): GenerateErrorClassification {
  if (err instanceof GenerateAbortedError) return { kind: 'abort' };
  if (err instanceof GenerateTimeoutError) return { kind: 'timeout' };
  const status = extractProviderErrorStatus(err);
  if (status === 401 || status === 403) return { kind: 'auth', status };
  if (looksLikeRateLimit(err)) return { kind: 'rate_limit', status: status ?? undefined };
  if (looksLikeModelNotFound(err)) return { kind: 'model_not_found', status: status ?? undefined };
  if (looksLikeSchemaError(err)) return { kind: 'schema' };
  return { kind: 'provider_unavailable' };
}
