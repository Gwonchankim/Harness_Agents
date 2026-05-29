import assert from 'node:assert/strict';
import { test } from 'node:test';

import { attachmentContentDisposition } from './contentDisposition';

test('contentDisposition: plain ASCII filename round-trips in both forms', () => {
  assert.equal(
    attachmentContentDisposition('result.md'),
    "attachment; filename=\"result.md\"; filename*=UTF-8''result.md",
  );
});

test('contentDisposition: extension is preserved', () => {
  const out = attachmentContentDisposition('team.json');
  assert.match(out, /filename="team\.json"/);
  assert.match(out, /filename\*=UTF-8''team\.json/);
});

test('contentDisposition: non-ASCII name → ASCII placeholder + percent-encoded filename*', () => {
  const out = attachmentContentDisposition('보고서.md');
  // ASCII fallback replaces each non-ASCII char with '_', extension kept.
  assert.match(out, /filename="_{3}\.md"/);
  // filename* carries the real UTF-8 name, percent-encoded.
  assert.match(out, /filename\*=UTF-8''%[0-9A-F]{2}/);
  assert.ok(out.includes('.md'));
});

test('contentDisposition: CR/LF and quotes cannot break out of the header', () => {
  const out = attachmentContentDisposition('a"b\r\nSet-Cookie: x=1\\c.md');
  assert.ok(!out.includes('\r'));
  assert.ok(!out.includes('\n'));
  // The literal double-quote inside the name is neutralized to '_'.
  assert.match(out, /filename="a_b/);
  assert.ok(!/filename="[^"]*"[^;]/.test(out)); // no stray unescaped quote mid-value
});

test('contentDisposition: all-unsafe name falls back to "download"', () => {
  const out = attachmentContentDisposition('\r\n\t');
  assert.match(out, /filename="download"/);
});

test('contentDisposition: RFC5987 reserved chars are percent-encoded in filename*', () => {
  const out = attachmentContentDisposition("a'(b)*.md");
  // ' ( ) * must not appear literally in the filename* token.
  const star = out.split("filename*=UTF-8''")[1] ?? '';
  assert.ok(!/['()*]/.test(star));
});

test('contentDisposition: empty input → both forms fall back to download (no empty filename*)', () => {
  assert.equal(
    attachmentContentDisposition(''),
    "attachment; filename=\"download\"; filename*=UTF-8''download",
  );
});

test('contentDisposition: whitespace-only input → both forms = download (no divergence)', () => {
  assert.equal(
    attachmentContentDisposition('   '),
    "attachment; filename=\"download\"; filename*=UTF-8''download",
  );
});

test('contentDisposition: control-only input → both forms = download', () => {
  assert.equal(
    attachmentContentDisposition('\r\n\t'),
    "attachment; filename=\"download\"; filename*=UTF-8''download",
  );
});

test('contentDisposition: semicolon stays literal in ASCII form, encoded in filename*', () => {
  assert.equal(
    attachmentContentDisposition('a;b.md'),
    "attachment; filename=\"a;b.md\"; filename*=UTF-8''a%3Bb.md",
  );
});

test('contentDisposition: pre-existing percent is re-encoded in filename*', () => {
  assert.equal(
    attachmentContentDisposition('a%20b.md'),
    "attachment; filename=\"a%20b.md\"; filename*=UTF-8''a%2520b.md",
  );
});

test('contentDisposition: backslash is neutralized in ASCII form, encoded in filename*', () => {
  const out = attachmentContentDisposition('a\\b.md');
  assert.match(out, /filename="a_b\.md"/); // backslash → '_' in ASCII fallback
  assert.match(out, /filename\*=UTF-8''a%5Cb\.md/); // raw backslash percent-encoded
});
