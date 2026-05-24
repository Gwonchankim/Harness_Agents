// Process-restart sweep. Marks any Run.status in ('planning','running') and
// any Task.status='running' as failed with reason='process_restart'. Idempotent
// guard prevents repeated invocation in a single process. Routes call
// `ensureRecovered()` near the top so the sweep runs at most once after boot.

import { prisma } from '@db/client';

import { appendEvent } from '@lib/events/append';

let recovered: Promise<void> | null = null;

const DEFAULT_RECOVERY_STALE_MS = 15 * 60 * 1000;

export function ensureRecovered(): Promise<void> {
  if (recovered) return recovered;
  recovered = recoverInterruptedRuns().catch((err) => {
    console.error('recovery_failed:', err);
  });
  return recovered;
}

async function recoverInterruptedRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - recoveryStaleMs());
  const stale = await prisma.run.findMany({
    where: {
      status: { in: ['planning', 'running'] },
      updatedAt: { lt: cutoff },
    },
    select: { id: true },
  });
  if (stale.length === 0) return;
  const now = new Date();
  for (const r of stale) {
    await prisma.$transaction([
      prisma.run.update({
        where: { id: r.id },
        data: { status: 'failed', failedReason: 'process_restart', endedAt: now },
      }),
      prisma.task.updateMany({
        where: { runId: r.id, status: 'running' },
        data: { status: 'failed', error: 'process_restart', completedAt: now },
      }),
    ]);
    try {
      await appendEvent({
        runId: r.id,
        type: 'run.completed',
        payload: {
          success: false,
          succeededTasks: 0,
          failedTasks: 0,
          failedReason: 'process_restart',
        },
      });
    } catch (err) {
      console.error('recovery_append_event_failed:', err);
    }
  }
}

function recoveryStaleMs(): number {
  const raw = Number(process.env.HARNESS_RECOVERY_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RECOVERY_STALE_MS;
}
