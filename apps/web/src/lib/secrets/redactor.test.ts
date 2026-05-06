import { strict as assert } from 'node:assert';
import { afterEach, test } from 'node:test';

import {
  clearKnownSecretsForTests,
  redact,
  redactString,
  registerKnownSecret,
} from './redactor';

afterEach(() => clearKnownSecretsForTests());

test('redactString masks Anthropic-style keys', () => {
  const out = redactString('header: sk-ant-abcdefghijklmnopqrstuvwxyz1234');
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /sk-ant-abc/);
});

test('redactString masks OpenAI-style keys', () => {
  const out = redactString('value=sk-abcdefghijklmnopqrstuvwxyz1234567890ABC');
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /sk-abc/);
});

test('redactString masks bearer tokens', () => {
  const out = redactString('Authorization: Bearer abcdef1234567890XYZ');
  assert.match(out, /Bearer \[REDACTED\]/);
});

test('registerKnownSecret scrubs the registered value', () => {
  registerKnownSecret('my-very-secret-token-1234');
  const out = redactString('payload contains my-very-secret-token-1234 inline');
  assert.match(out, /\[REDACTED\]/);
  assert.doesNotMatch(out, /secret-token/);
});

test('registerKnownSecret ignores tiny strings', () => {
  registerKnownSecret('abc');
  const out = redactString('abc inside');
  assert.equal(out, 'abc inside');
});

test('redact preserves shape of nested objects', () => {
  registerKnownSecret('my-very-secret-token-1234');
  const input = {
    user: 'alice',
    headers: { Authorization: 'Bearer abcdef1234567890XYZ' },
    notes: ['ok', 'leak: my-very-secret-token-1234'],
  };
  const out = redact(input);
  assert.equal(out.user, 'alice');
  assert.match(out.headers.Authorization, /Bearer \[REDACTED\]/);
  assert.equal(out.notes[0], 'ok');
  assert.match(out.notes[1] as string, /\[REDACTED\]/);
});

test('redact handles cycles', () => {
  const a: Record<string, unknown> = { name: 'cycle' };
  a.self = a;
  const out = redact(a) as Record<string, unknown>;
  assert.equal(out.name, 'cycle');
  assert.equal(out.self, '[Circular]');
});

test('redact converts Error to plain object', () => {
  registerKnownSecret('my-very-secret-token-1234');
  const err = new Error('boom: my-very-secret-token-1234');
  const out = redact(err);
  assert.equal((out as { name: string }).name, 'Error');
  assert.match((out as { message: string }).message, /\[REDACTED\]/);
});
