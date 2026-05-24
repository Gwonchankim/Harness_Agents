import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clearKnownSecretsForTests,
  registerKnownSecret,
} from '@lib/secrets/redactor';

import { MAX_EVENT_TEXT_BYTES, redactEventPayload } from './redactor';

test('redactEventPayload: scrubs registered secret values inside nested object', () => {
  clearKnownSecretsForTests();
  registerKnownSecret('sk-test-supersecret-9999');
  const out = redactEventPayload({
    type: 'agent.output.delta',
    payload: { taskKey: 'a', text: 'leaking sk-test-supersecret-9999 in output' },
  }) as { payload: { text: string } };
  assert.ok(!out.payload.text.includes('sk-test-supersecret-9999'));
  assert.ok(out.payload.text.includes('[REDACTED]'));
  clearKnownSecretsForTests();
});

test('redactEventPayload: scrubs Anthropic-pattern keys without registration', () => {
  clearKnownSecretsForTests();
  const leak = 'sk-ant-' + 'A'.repeat(48);
  const out = redactEventPayload({ payload: { text: `prefix ${leak} suffix` } }) as {
    payload: { text: string };
  };
  assert.ok(!out.payload.text.includes(leak));
});

test('redactEventPayload: leaves short strings untouched', () => {
  clearKnownSecretsForTests();
  const value = 'normal short content';
  const out = redactEventPayload({ s: value }) as { s: string };
  assert.equal(out.s, value);
});

test('redactEventPayload: truncates oversize strings into a marker object', () => {
  clearKnownSecretsForTests();
  const big = 'X'.repeat(MAX_EVENT_TEXT_BYTES + 256);
  const out = redactEventPayload({ payload: { text: big } }) as {
    payload: { text: { truncated?: boolean; text?: string; originalBytes?: number } };
  };
  const t = out.payload.text;
  assert.ok(t && typeof t === 'object', 'truncation produces object replacement');
  assert.equal(t.truncated, true);
  assert.equal(t.originalBytes, MAX_EVENT_TEXT_BYTES + 256);
  assert.ok(typeof t.text === 'string' && t.text.length <= MAX_EVENT_TEXT_BYTES);
});

test('redactEventPayload: walks arrays and preserves non-string scalars', () => {
  clearKnownSecretsForTests();
  const out = redactEventPayload({
    items: [
      { ok: true, n: 1 },
      { ok: false, n: 2 },
    ],
  }) as { items: Array<{ ok: boolean; n: number }> };
  assert.equal(out.items.length, 2);
  assert.equal(out.items[0]!.ok, true);
  assert.equal(out.items[1]!.n, 2);
});

test('redactEventPayload: tolerates null and undefined fields', () => {
  clearKnownSecretsForTests();
  const out = redactEventPayload({ a: null, b: undefined, c: 'x' }) as Record<string, unknown>;
  assert.equal(out.a, null);
  assert.equal(out.c, 'x');
});

test('MAX_EVENT_TEXT_BYTES is the documented 4 KiB limit', () => {
  assert.equal(MAX_EVENT_TEXT_BYTES, 4 * 1024);
});
