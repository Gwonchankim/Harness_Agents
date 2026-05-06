// Compose a route's request.signal with a server-side wall-clock timeout.
// The PO module uses this for every generateObject call so the route doesn't
// have to repeat the abort/timeout dance.

/** Cloud-provider default. Empirically enough for OpenAI / Anthropic. */
export const PO_GENERATE_TIMEOUT_MS = 30_000;

/** Local Ollama models can take much longer; default to 2 minutes. */
export const OLLAMA_PO_GENERATE_TIMEOUT_MS = 120_000;

/**
 * Resolve the wall-clock budget for a single PO `generateObject` call. Reads
 * env overrides if present; otherwise picks a provider-appropriate default.
 *
 * - HARNESS_OLLAMA_PO_GENERATE_TIMEOUT_MS — overrides only the Ollama default.
 * - HARNESS_PO_GENERATE_TIMEOUT_MS        — overrides every provider's default
 *   (Ollama-specific override still wins for Ollama).
 */
export function resolvePoGenerateTimeoutMs(provider: string): number {
  if (provider === 'ollama') {
    const ollamaSpecific = parsePositiveInt(process.env.HARNESS_OLLAMA_PO_GENERATE_TIMEOUT_MS);
    if (ollamaSpecific != null) return ollamaSpecific;
    const general = parsePositiveInt(process.env.HARNESS_PO_GENERATE_TIMEOUT_MS);
    if (general != null) return general;
    return OLLAMA_PO_GENERATE_TIMEOUT_MS;
  }
  const general = parsePositiveInt(process.env.HARNESS_PO_GENERATE_TIMEOUT_MS);
  if (general != null) return general;
  return PO_GENERATE_TIMEOUT_MS;
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export class GenerateTimeoutError extends Error {
  public readonly provider?: string;
  public readonly modelId?: string;

  constructor(
    public readonly timeoutMs: number,
    options: { provider?: string; modelId?: string } = {},
  ) {
    super(`generate_timeout: exceeded ${timeoutMs}ms`);
    this.name = 'GenerateTimeoutError';
    this.provider = options.provider;
    this.modelId = options.modelId;
  }
}

export class GenerateAbortedError extends Error {
  constructor() {
    super('generate_aborted: client disconnected');
    this.name = 'GenerateAbortedError';
  }
}

/**
 * Run `fn(signal)` with a composite signal: aborted whenever the parent signal
 * fires OR the timeout elapses. On abort, throws GenerateAbortedError; on
 * timeout, throws GenerateTimeoutError. Other errors propagate unchanged.
 */
export async function runWithGenerateTimeout<T>(
  parent: AbortSignal | undefined,
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = PO_GENERATE_TIMEOUT_MS,
): Promise<T> {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), timeoutMs);

  // AbortSignal.any is available in Node 20.3+; engines pin >=20.9.
  const composite: AbortSignal = parent
    ? (AbortSignal as { any(s: AbortSignal[]): AbortSignal }).any([
        timeoutController.signal,
        parent,
      ])
    : timeoutController.signal;

  try {
    return await fn(composite);
  } catch (err) {
    if (composite.aborted) {
      if (timeoutController.signal.aborted && !(parent?.aborted ?? false)) {
        throw new GenerateTimeoutError(timeoutMs);
      }
      throw new GenerateAbortedError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
