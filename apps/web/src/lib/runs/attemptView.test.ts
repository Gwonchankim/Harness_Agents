import assert from 'node:assert/strict';
import { test } from 'node:test';

import { truncateForPreview } from './attemptView';

test('truncateForPreview: shorter than max → full, not truncated', () => {
  assert.deepEqual(truncateForPreview('hello', 2000), {
    preview: 'hello',
    truncated: false,
    totalChars: 5,
  });
});

test('truncateForPreview: equal to max → full, not truncated (boundary)', () => {
  assert.deepEqual(truncateForPreview('abcde', 5), {
    preview: 'abcde',
    truncated: false,
    totalChars: 5,
  });
});

test('truncateForPreview: longer than max → sliced + truncated + totalChars', () => {
  const text = 'x'.repeat(2500);
  const r = truncateForPreview(text, 2000);
  assert.equal(r.preview.length, 2000);
  assert.equal(r.truncated, true);
  assert.equal(r.totalChars, 2500);
});

test('truncateForPreview: empty string', () => {
  assert.deepEqual(truncateForPreview('', 2000), {
    preview: '',
    truncated: false,
    totalChars: 0,
  });
});
