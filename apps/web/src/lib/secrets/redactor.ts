// Redaction utility used before any secret-bearing payload is persisted to
// the DB (ToolCall args/result, RunEvent payload) or surfaced in error logs.
//
// Two layers:
//   1. Pattern matchers — Anthropic / OpenAI / generic Bearer tokens.
//   2. A dynamic known-values list, populated whenever the secret store
//      decrypts a row. The cache is process-local and clears on restart.

const PLACEHOLDER = '[REDACTED]';

const PATTERNS: ReadonlyArray<RegExp> = [
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-proj-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
];
const BEARER_PATTERN = /Bearer\s+[A-Za-z0-9._-]{16,}/g;

const knownValues = new Set<string>();

/**
 * Register a plaintext secret value so the redactor can scrub it from any
 * downstream string. Called from the secret store after decrypt.
 */
export function registerKnownSecret(value: string | null | undefined): void {
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  // Avoid registering tiny values like "" or short identifiers that would
  // produce false positives.
  if (trimmed.length < 8) return;
  knownValues.add(trimmed);
}

export function clearKnownSecretsForTests(): void {
  knownValues.clear();
}

export function listKnownSecretsForTests(): string[] {
  return Array.from(knownValues);
}

/** Apply redaction to a single string. Exported for direct use in error paths. */
export function redactString(input: string): string {
  let out = input;
  for (const value of knownValues) {
    if (value && out.includes(value)) {
      out = out.split(value).join(PLACEHOLDER);
    }
  }
  out = out.replace(BEARER_PATTERN, `Bearer ${PLACEHOLDER}`);
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, PLACEHOLDER);
  }
  return out;
}

/**
 * Walk an arbitrary value and return a structurally identical copy with all
 * strings redacted. Cycles short-circuit to '[Circular]'. Functions and
 * symbols are dropped. Buffers are coerced to '[Buffer]'.
 */
export function redact<T>(value: T): T {
  return walk(value, new WeakSet()) as T;
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (typeof value === 'object') {
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return '[Buffer]';
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);
    if (Array.isArray(value)) {
      return value.map((v) => walk(v, seen));
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: redactString(value.message),
        stack: value.stack ? redactString(value.stack) : undefined,
      };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = walk(v, seen);
    }
    return out;
  }
  return value;
}
