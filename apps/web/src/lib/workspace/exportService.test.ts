import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const tempRoot = mkdtempSync(join(tmpdir(), 'harness-export-'));
const previousRoot = process.env.HARNESS_WORKSPACE_ROOT;

before(() => {
  process.env.HARNESS_WORKSPACE_ROOT = tempRoot;
});

after(() => {
  if (previousRoot === undefined) delete process.env.HARNESS_WORKSPACE_ROOT;
  else process.env.HARNESS_WORKSPACE_ROOT = previousRoot;
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    /* ignore cleanup error */
  }
});

test('exportTeamFiles writes both files when under the size guard', async () => {
  const { exportTeamFiles } = await import('./exportService');
  const result = await exportTeamFiles({
    projectSlug: 'p1',
    teamId: 't-small',
    agentsMd: '# Tiny team\n',
    teamJson: '{"schemaVersion":1}',
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.wrote.length, 2);
  for (const w of result.wrote) {
    assert.ok(existsSync(join(tempRoot, ...w.path.split('/'))));
  }
});

test('exportTeamFiles surfaces an oversize payload as errors[] without writing it', async () => {
  const { exportTeamFiles, MAX_EXPORT_BYTES } = await import('./exportService');
  const oversize = 'x'.repeat(MAX_EXPORT_BYTES + 1);
  const result = await exportTeamFiles({
    projectSlug: 'p1',
    teamId: 't-big',
    agentsMd: oversize,
    teamJson: '{"schemaVersion":1}',
  });

  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0]?.path, 'p1/teams/t-big/AGENTS.md');
  assert.match(result.errors[0]!.message, /export exceeds \d+ bytes/);

  // The team.json (under the limit) still wrote.
  assert.equal(result.wrote.length, 1);
  assert.equal(result.wrote[0]?.kind, 'team_json');
  assert.ok(existsSync(join(tempRoot, 'p1', 'teams', 't-big', 'team.json')));
  assert.equal(
    existsSync(join(tempRoot, 'p1', 'teams', 't-big', 'AGENTS.md')),
    false,
    'no AGENTS.md should be written when the payload exceeds the guard',
  );
});

test('MAX_EXPORT_BYTES matches the documented limit', async () => {
  const { MAX_EXPORT_BYTES } = await import('./exportService');
  assert.equal(MAX_EXPORT_BYTES, 5 * 1024 * 1024);
});
