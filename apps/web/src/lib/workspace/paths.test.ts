import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { test } from 'node:test';

import { isWithin, safeJoin, SafePathError } from './paths';

const root = mkdtempSync(join(tmpdir(), 'harness-paths-'));

process.on('exit', () => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test('safeJoin allows nested relative paths', () => {
  const result = safeJoin(root, 'projects', 'default', 'runs', 'r1');
  assert.equal(result, resolve(root, 'projects', 'default', 'runs', 'r1'));
});

test('safeJoin rejects parent traversal', () => {
  assert.throws(() => safeJoin(root, '..', 'etc'), SafePathError);
  assert.throws(() => safeJoin(root, 'a', '..', '..', 'b'), SafePathError);
});

test('safeJoin rejects absolute segments', () => {
  assert.throws(() => safeJoin(root, '/etc/passwd'), SafePathError);
  if (process.platform === 'win32') {
    assert.throws(() => safeJoin(root, 'C:\\Windows'), SafePathError);
  }
});

test('safeJoin rejects Windows drive-letter segments', () => {
  assert.throws(() => safeJoin(root, 'C:foo'), SafePathError);
});

test('safeJoin rejects UNC segments', () => {
  assert.throws(() => safeJoin(root, '\\\\server\\share'), SafePathError);
  assert.throws(() => safeJoin(root, '//server/share'), SafePathError);
});

test('safeJoin rejects NUL bytes', () => {
  assert.throws(() => safeJoin(root, 'a\0b'), SafePathError);
});

test('safeJoin rejects empty base', () => {
  assert.throws(() => safeJoin('', 'foo'), SafePathError);
});

test('safeJoin rejects empty segments', () => {
  assert.throws(() => safeJoin(root, ''), SafePathError);
});

test('isWithin treats identical paths as inside', () => {
  assert.equal(isWithin(root, root), true);
});

test('isWithin rejects sibling escapes', () => {
  assert.equal(isWithin(root, resolve(root, '..', 'sibling')), false);
});

test('isWithin allows nested children', () => {
  assert.equal(isWithin(root, resolve(root, 'a', 'b', 'c')), true);
});

if (process.platform === 'win32') {
  test('isWithin rejects cross-drive paths on Windows', () => {
    const otherDrive = root.toUpperCase().startsWith('C:') ? `D:${sep}foo` : `C:${sep}foo`;
    assert.equal(isWithin(root, otherDrive), false);
  });
}
