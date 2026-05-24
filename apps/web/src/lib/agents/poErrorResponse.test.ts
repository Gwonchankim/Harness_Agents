import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ModelDisabledError, UnknownProviderError } from '@lib/models/catalog';
import { GenerateAbortedError, GenerateTimeoutError } from '@lib/qa/timeout';

import {
  ModelNotFoundError,
  PoAuthError,
  PoSchemaError,
  ProviderUnavailableError,
  RateLimitError,
} from './po';
import { poErrorPayload } from './poErrorResponse';

test('poErrorPayload: control-flow + provider errors map to expected statuses', () => {
  assert.equal(poErrorPayload(new GenerateAbortedError()).status, 499);
  assert.equal(poErrorPayload(new GenerateAbortedError()).body.error, 'aborted');

  const timeout = poErrorPayload(new GenerateTimeoutError(5000, { provider: 'openai', modelId: 'm' }));
  assert.equal(timeout.status, 504);
  assert.equal(timeout.body.error, 'timeout');
  assert.equal(timeout.body.timeoutMs, 5000);

  assert.equal(poErrorPayload(new PoAuthError('openai', 401)).status, 401);
  assert.equal(poErrorPayload(new PoAuthError('openai', 401)).body.error, 'provider_auth_failed');

  assert.equal(poErrorPayload(new ProviderUnavailableError('ollama', 'down')).status, 503);
  assert.equal(poErrorPayload(new PoSchemaError(new Error('x'))).status, 502);
  assert.equal(poErrorPayload(new UnknownProviderError('foo')).status, 500);
  assert.equal(poErrorPayload(new ModelDisabledError('m')).status, 409);
});

test('poErrorPayload: new rate_limit + model_not_found statuses', () => {
  const rate = poErrorPayload(new RateLimitError('openai', 429));
  assert.equal(rate.status, 429);
  assert.equal(rate.body.error, 'rate_limit');

  const notFound = poErrorPayload(new ModelNotFoundError('google', 'gpt-x'));
  assert.equal(notFound.status, 404);
  assert.equal(notFound.body.error, 'model_not_found');
  assert.equal(notFound.body.modelId, 'gpt-x');
});

test('poErrorPayload: fallback code is configurable', () => {
  const def = poErrorPayload(new Error('boom'));
  assert.equal(def.status, 500);
  assert.equal(def.body.error, 'generation_failed');

  const custom = poErrorPayload(new Error('boom'), 'team_recommend_failed');
  assert.equal(custom.body.error, 'team_recommend_failed');
});
