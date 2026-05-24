// Two-pass redactor for RunEvent payloads:
//   1. Run the Phase 1 secret redactor (`redact`) so any known-value or
//      pattern-matched token is scrubbed before it can land in DB or stream.
//   2. Walk the result and truncate any string >MAX_EVENT_TEXT_BYTES, replacing
//      it with `{ truncated: true, text: <cut>, originalBytes }`.
//
// Phase 4 keeps each `agent.output.delta` chunk under DELTA_FLUSH_BYTES at the
// emit site, so this guard is rarely tripped — it exists so a single misbehaving
// model emission can't blow up an event row.

import { redact } from '@lib/secrets/redactor';

export const MAX_EVENT_TEXT_BYTES = 4 * 1024;

export function redactEventPayload<T = unknown>(payload: T): T {
  const sanitized = redact(payload);
  return truncateLongStrings(sanitized) as T;
}

function truncateLongStrings(value: unknown): unknown {
  if (typeof value === 'string') {
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes <= MAX_EVENT_TEXT_BYTES) return value;
    let cut = value.slice(0, MAX_EVENT_TEXT_BYTES);
    while (Buffer.byteLength(cut, 'utf8') > MAX_EVENT_TEXT_BYTES) {
      cut = cut.slice(0, -16);
    }
    return { truncated: true, text: cut, originalBytes: bytes };
  }
  if (Array.isArray(value)) return value.map(truncateLongStrings);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = truncateLongStrings(v);
    }
    return out;
  }
  return value;
}
