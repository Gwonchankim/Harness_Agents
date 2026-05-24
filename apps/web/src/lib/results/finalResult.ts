import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, relative, sep } from 'node:path';

import { prisma } from '@db/client';

import { safeJoin, workspaceRoot } from '@lib/workspace/paths';

export interface FinalResultTaskInput {
  taskKey: string;
  title: string;
  agentName: string;
  text: string;
}

export interface FinalResultInput {
  runId: string;
  userPrompt: string;
  teamName: string;
  tasks: FinalResultTaskInput[];
}

export interface ResultExport {
  path: string;
  absPath: string;
  bytes: number;
  sha256: string;
  mimeType: string;
}

const FINAL_TASK_PATTERN = /\b(final|compile|compilation|synth|synthesis|deliverable|documentation|mvp)\b/i;
const MAX_RESULT_BYTES = 5 * 1024 * 1024;

export function buildFinalResultMarkdown(input: FinalResultInput): string {
  const completed = input.tasks.filter((task) => task.text.trim().length > 0);
  const finalTask =
    completed.find((task) => FINAL_TASK_PATTERN.test(`${task.taskKey} ${task.title}`)) ??
    completed[completed.length - 1] ??
    null;

  const lines: string[] = [
    `# Final Result - ${input.teamName}`,
    '',
    '## Original Request',
    input.userPrompt.trim(),
    '',
    '## Final Output',
  ];

  if (finalTask) {
    lines.push(finalTask.text.trim());
  } else {
    lines.push('No completed agent output was available for synthesis.');
  }

  lines.push('', '## Supporting Agent Outputs');
  if (completed.length === 0) {
    lines.push('', 'No agent outputs were recorded.');
  } else {
    for (const task of completed) {
      lines.push(
        '',
        `### ${task.title}`,
        '',
        `- Task: \`${task.taskKey}\``,
        `- Agent: ${task.agentName}`,
        '',
        task.text.trim(),
      );
    }
  }

  lines.push('', '---', `Generated from Run ${input.runId}.`);
  return `${lines.join('\n')}\n`;
}

export async function exportRunResultMd(input: {
  projectSlug: string;
  runId: string;
  markdown: string;
}): Promise<ResultExport> {
  return writeWorkspaceFile(
    [input.projectSlug, 'runs', input.runId, 'result.md'],
    input.markdown,
    'text/markdown',
  );
}

export async function loadRunResultMarkdown(runId: string): Promise<string | null> {
  const artifact = await prisma.artifact.findFirst({
    where: { runId, kind: 'result_md' },
    orderBy: { createdAt: 'desc' },
    select: { path: true },
  });
  if (!artifact) return null;
  try {
    return await readFile(safeJoin(workspaceRoot(), artifact.path), 'utf8');
  } catch {
    return null;
  }
}

async function writeWorkspaceFile(
  relParts: string[],
  content: string,
  mimeType: string,
): Promise<ResultExport> {
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_RESULT_BYTES) {
    throw new Error(`result export exceeds ${MAX_RESULT_BYTES} bytes`);
  }

  const root = workspaceRoot();
  const absPath = safeJoin(root, ...relParts);
  await mkdir(dirname(absPath), { recursive: true });

  const tmp = `${absPath}.tmp-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, absPath);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch {
      /* ignore cleanup error */
    }
    throw err;
  }

  return {
    path: relative(root, absPath).split(sep).join('/'),
    absPath,
    bytes,
    sha256: createHash('sha256').update(content, 'utf8').digest('hex'),
    mimeType,
  };
}
