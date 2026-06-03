import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodePreview } from './artifactPreview';

test('decodePreview: ASCII under cap, complete file → full, not truncated', () => {
  assert.deepEqual(decodePreview(Buffer.from('hello'), false, 100), {
    preview: 'hello',
    truncated: false,
  });
});

test('decodePreview: ASCII over char cap → sliced, truncated', () => {
  assert.deepEqual(decodePreview(Buffer.from('x'.repeat(200)), false, 100), {
    preview: 'x'.repeat(100),
    truncated: true,
  });
});

test('decodePreview: empty buffer → empty, not truncated', () => {
  assert.deepEqual(decodePreview(Buffer.from(''), false, 100), {
    preview: '',
    truncated: false,
  });
});

test('decodePreview: hadMore=true alone forces truncated even under cap', () => {
  assert.deepEqual(decodePreview(Buffer.from('hi'), true, 100), {
    preview: 'hi',
    truncated: true,
  });
});

test('decodePreview: char cap exactly at length → not truncated', () => {
  assert.deepEqual(decodePreview(Buffer.from('hello'), false, 5), {
    preview: 'hello',
    truncated: false,
  });
});

test('decodePreview: char cap AND byte-over simultaneously → truncated', () => {
  assert.deepEqual(decodePreview(Buffer.from('abcdef'), true, 3), {
    preview: 'abc',
    truncated: true,
  });
});

test('decodePreview: complete multibyte file decoded whole (no trim)', () => {
  assert.deepEqual(decodePreview(Buffer.from('世界'), false, 100), {
    preview: '世界',
    truncated: false,
  });
});

test('decodePreview: UTF-8 multibyte boundary cut drops incomplete trailing char (no U+FFFD)', () => {
  // '世界' = E4 B8 96 | E7 95 8C. Cut to 4 bytes keeps 世 + lead byte of 界.
  const full = Buffer.from('世界');
  const cut = full.subarray(0, 4);
  const { preview, truncated } = decodePreview(cut, true, 100);
  assert.equal(preview, '世'); // incomplete 界 dropped
  assert.equal(truncated, true);
  assert.ok(!preview.includes('�')); // no replacement-char damage
});

test('decodePreview: 4-byte emoji cut mid-sequence drops it cleanly', () => {
  // '😀' = F0 9F 98 80 (4 bytes). 'a' + first 2 bytes of emoji.
  const buf = Buffer.concat([Buffer.from('a'), Buffer.from('😀').subarray(0, 2)]);
  const { preview, truncated } = decodePreview(buf, true, 100);
  assert.equal(preview, 'a');
  assert.equal(truncated, true);
  assert.ok(!preview.includes('�'));
});

test('decodePreview: negative maxChars disables char cap (still honors hadMore)', () => {
  assert.deepEqual(decodePreview(Buffer.from('hello'), false, -1), {
    preview: 'hello',
    truncated: false,
  });
});
