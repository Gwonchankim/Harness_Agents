import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GenerateAbortedError, GenerateTimeoutError } from '@lib/qa/timeout';
import {
  classifyGenerateError,
  extractProviderErrorStatus,
  extractRetryAfterMs,
  looksLikeModelNotFound,
  looksLikeRateLimit,
  looksLikeSchemaError,
} from './providerError';

test('extractRetryAfterMs: delta-seconds from responseHeaders/headers, else undefined', () => {
  assert.equal(extractRetryAfterMs({ responseHeaders: { 'retry-after': '30' } }), 30_000);
  assert.equal(extractRetryAfterMs({ headers: { 'Retry-After': '5' } }), 5000);
  assert.equal(extractRetryAfterMs({ responseHeaders: { 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' } }), undefined);
  assert.equal(extractRetryAfterMs({ responseHeaders: { 'retry-after': '30s' } }), undefined);
  assert.equal(extractRetryAfterMs({ responseHeaders: {} }), undefined);
  assert.equal(extractRetryAfterMs(new Error('nope')), undefined);
  assert.equal(extractRetryAfterMs(null), undefined);
});

test('classifyGenerateError: rate_limit carries retryAfterMs when header present', () => {
  const withHeader = { statusCode: 429, responseHeaders: { 'retry-after': '12' } };
  const c = classifyGenerateError(withHeader);
  assert.equal(c.kind, 'rate_limit');
  assert.equal(c.retryAfterMs, 12_000);
  const withoutHeader = classifyGenerateError({ statusCode: 429 });
  assert.equal(withoutHeader.kind, 'rate_limit');
  assert.equal(withoutHeader.retryAfterMs, undefined);
});

test('classifyGenerateError: control-flow errors pass through', () => {
  assert.equal(classifyGenerateError(new GenerateAbortedError()).kind, 'abort');
  assert.equal(classifyGenerateError(new GenerateTimeoutError(5000)).kind, 'timeout');
});

test('classifyGenerateError: auth via status field and message', () => {
  assert.deepEqual(classifyGenerateError({ statusCode: 401 }), { kind: 'auth', status: 401 });
  assert.deepEqual(classifyGenerateError({ status: 403 }), { kind: 'auth', status: 403 });
  assert.equal(classifyGenerateError(new Error('401 Unauthorized')).kind, 'auth');
  assert.equal(classifyGenerateError(new Error('Forbidden (403)')).kind, 'auth');
});

test('classifyGenerateError: rate_limit via 429 and message', () => {
  assert.equal(classifyGenerateError({ statusCode: 429 }).kind, 'rate_limit');
  assert.equal(classifyGenerateError(new Error('rate limit exceeded')).kind, 'rate_limit');
  assert.equal(classifyGenerateError(new Error('429 too many requests')).kind, 'rate_limit');
});

test('classifyGenerateError: model_not_found via 404 and message', () => {
  assert.equal(classifyGenerateError({ statusCode: 404 }).kind, 'model_not_found');
  assert.equal(
    classifyGenerateError(new Error('The model gpt-x does not exist')).kind,
    'model_not_found',
  );
  assert.equal(classifyGenerateError(new Error('no such model')).kind, 'model_not_found');
});

test('classifyGenerateError: schema errors', () => {
  const named = new Error('boom');
  named.name = 'AI_NoObjectGeneratedError';
  assert.equal(classifyGenerateError(named).kind, 'schema');
  assert.equal(classifyGenerateError(new Error('No object generated')).kind, 'schema');
  assert.equal(classifyGenerateError(new Error('zod validation failed')).kind, 'schema');
});

test('classifyGenerateError: everything else → provider_unavailable', () => {
  assert.equal(classifyGenerateError(new Error('ECONNREFUSED')).kind, 'provider_unavailable');
  assert.equal(classifyGenerateError({ statusCode: 500 }).kind, 'provider_unavailable');
  assert.equal(classifyGenerateError('weird string').kind, 'provider_unavailable');
});

test('extractProviderErrorStatus: field then message, else null', () => {
  assert.equal(extractProviderErrorStatus({ statusCode: 503 }), 503);
  assert.equal(extractProviderErrorStatus({ status: 429 }), 429);
  assert.equal(extractProviderErrorStatus(new Error('failed with 404')), 404);
  assert.equal(extractProviderErrorStatus(new Error('plain message')), null);
  assert.equal(extractProviderErrorStatus({}), null);
});

test('looksLike* predicates', () => {
  assert.equal(looksLikeRateLimit(new Error('quota exceeded')), true);
  assert.equal(looksLikeRateLimit(new Error('ok')), false);
  assert.equal(looksLikeModelNotFound(new Error('unknown model foo')), true);
  assert.equal(looksLikeModelNotFound(new Error('ok')), false);
  assert.equal(looksLikeSchemaError(new Error('invalid object returned')), true);
  assert.equal(looksLikeSchemaError('not an error'), false);
});
