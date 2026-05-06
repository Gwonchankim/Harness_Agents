// Compose a route's request.signal with a server-side wall-clock timeout.
// The PO module uses this for every generateObject call so the route doesn't
// have to repeat the abort/timeout dance.

export const PO_GENERATE_TIMEOUT_MS = 30_000;

export class GenerateTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`generate_timeout: exceeded ${timeoutMs}ms`);
    this.name = 'GenerateTimeoutError';
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
