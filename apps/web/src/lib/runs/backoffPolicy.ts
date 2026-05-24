// Pure provider-retry backoff policy (Phase 8). Decides whether a task that failed
// with a given provider-error kind should be retried in place, and how long to
// wait. Only transient kinds retry: rate_limit (2x) and timeout (1x). Persistent
// kinds (auth / schema / model_not_found / provider_unavailable / unknown / abort)
// fail immediately; auto-retrying them just wastes time and money.
//
// Deterministic (no jitter) so it is fully unit-testable; the executor performs
// the actual abortable sleep. Counts/delays are env-overridable.

import type { GenerateErrorKind } from '@lib/agents/providerError';

export interface BackoffDecision {
  retry: boolean;
  delayMs: number;
}

interface KindConfig {
  max: number;
  baseMs: number;
  maxDelayMs: number;
}

const MAX_DELAY_MS = 30_000;

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function configFor(kind: GenerateErrorKind): KindConfig {
  switch (kind) {
    case 'rate_limit':
      return {
        max: envInt('HARNESS_TASK_RETRY_RATE_LIMIT_MAX', 2),
        baseMs: envInt('HARNESS_TASK_RETRY_BASE_MS', 2000),
        maxDelayMs: MAX_DELAY_MS,
      };
    case 'timeout':
      return {
        max: envInt('HARNESS_TASK_RETRY_TIMEOUT_MAX', 1),
        baseMs: envInt('HARNESS_TASK_RETRY_TIMEOUT_BASE_MS', 5000),
        maxDelayMs: MAX_DELAY_MS,
      };
    default:
      return { max: 0, baseMs: 0, maxDelayMs: 0 };
  }
}

/**
 * Whether a task that just failed with `kind` should be retried, and the delay.
 * `attemptsSoFar` = failed attempts already made (1 after the first failure).
 */
export function nextBackoff(kind: GenerateErrorKind, attemptsSoFar: number): BackoffDecision {
  const cfg = configFor(kind);
  if (attemptsSoFar < 1 || attemptsSoFar > cfg.max) {
    return { retry: false, delayMs: 0 };
  }
  const delayMs = Math.min(cfg.baseMs * 2 ** (attemptsSoFar - 1), cfg.maxDelayMs);
  return { retry: true, delayMs };
}
