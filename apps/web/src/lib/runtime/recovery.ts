// Process-restart sweep. Marks any Run.status in ('planning','running') and
// any Task.status='running' as failed with reason='process_restart'. Idempotent
// guard prevents repeated invocation in a single process. Routes call
// `ensureRecovered()` near the top so the sweep runs at most once after boot.
//
// Phase 10 (additive): the fail-marking above is left untouched. When
// HARNESS_AUTORESUME is enabled, each just-marked run that meets the conservative
// eligibility gate (`shouldAutoResume`) is auto-resumed via prepareResume +
// executeResume. Auto-resume failures are recorded and left failed (no retry).
//
// Known limitation: like the rest of the run machinery (see runRegistry.ts), this
// assumes a SINGLE Next worker / process. The de-dup guard (executor `inFlight`)
// and controller registry are process-local, so under multiple workers the same
// run could be auto-resumed by more than one worker (double provider execution).
// A cross-process claim/lock would be needed for multi-worker deployments.

import { prisma } from '@db/client';

import { executeResume } from '@lib/dag/executor';
import { clearRunController, registerRunController } from '@lib/dag/runRegistry';
import { appendEvent } from '@lib/events/append';
import { isResumeError, prepareResume } from '@lib/runs/resume';

let recovered: Promise<void> | null = null;

const DEFAULT_RECOVERY_STALE_MS = 15 * 60 * 1000;

// Conservative auto-resume eligibility (Phase 10, decision #2). Pure so it is
// unit-testable: only resume genuine process_restart interruptions that have
// saved progress to reuse (done >= 1) and work still left (nonDone >= 1).
export interface AutoResumeCandidate {
  failedReason: string | null;
  hasPlan: boolean;
  doneCount: number;
  nonDoneCount: number;
}

export function shouldAutoResume(
  run: AutoResumeCandidate,
  opts: { autoResume: boolean },
): boolean {
  if (!opts.autoResume) return false;
  if (run.failedReason !== 'process_restart') return false;
  if (!run.hasPlan) return false;
  if (run.doneCount < 1) return false;
  if (run.nonDoneCount < 1) return false;
  return true;
}

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
  const autoResume = autoResumeEnabled();
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

    // Phase 10: the run is now failed(process_restart). If enabled, auto-resume
    // eligible runs as a purely additive step on top of the unchanged fail path.
    if (autoResume) {
      await maybeAutoResume(r.id);
    }
  }
}

async function maybeAutoResume(runId: string): Promise<void> {
  // Re-read the just-marked run to evaluate the conservative eligibility gate.
  const run = await prisma.run.findUnique({
    where: { id: runId },
    select: {
      failedReason: true,
      plan: { select: { id: true } },
      tasks: { select: { status: true } },
    },
  });
  if (!run) return;
  const doneCount = run.tasks.filter((t) => t.status === 'done').length;
  const eligible = shouldAutoResume(
    {
      failedReason: run.failedReason,
      hasPlan: run.plan != null,
      doneCount,
      nonDoneCount: run.tasks.length - doneCount,
    },
    { autoResume: true },
  );
  if (!eligible) return;

  // prepareResume flips the run back to running, resets failed/cancelled tasks to
  // pending (reusing done results), and emits task.reset + run.resumed(trigger).
  const prepared = await prepareResume(runId, { kind: 'auto' }, { trigger: 'process_restart' });
  if (isResumeError(prepared)) {
    // Benign: nothing left to resume (e.g. only pending tasks, no failed/cancelled
    // to reset). Not an auto-resume failure — leave the run failed without noise.
    if (prepared.error === 'no_resumable_tasks') return;
    // Decision #5: do not retry — leave failed, record the failure.
    await appendAutoResumeFailed(runId, prepared.error);
    return;
  }

  // Fire-and-forget the resume executor, mirroring the /resume route.
  const controller = new AbortController();
  registerRunController(runId, controller);
  void executeResume(runId, { signal: controller.signal })
    .catch(async (err) => {
      console.error(`auto-resume executeResume threw for runId=${runId}:`, err);
      // Defensive: if the executor escaped without settling the run, leave it failed.
      try {
        await prisma.run.updateMany({
          where: { id: runId, status: 'running' },
          data: { status: 'failed', failedReason: 'autoresume_failed', endedAt: new Date() },
        });
      } catch (e) {
        console.error('auto-resume failback update failed:', e);
      }
      // Only record an auto-resume failure if the run actually ended failed — the
      // executor may have already settled it (succeeded, or failed on its own).
      const after = await prisma.run.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (after?.status === 'failed') {
        await appendAutoResumeFailed(runId, 'executor_threw');
      }
    })
    .finally(() => {
      clearRunController(runId);
    });
}

async function appendAutoResumeFailed(runId: string, reason: string): Promise<void> {
  try {
    await appendEvent({ runId, type: 'run.autoresume.failed', payload: { reason } });
  } catch (err) {
    console.error('recovery_append_event_failed:', err);
  }
}

function autoResumeEnabled(): boolean {
  const raw = (process.env.HARNESS_AUTORESUME ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function recoveryStaleMs(): number {
  const raw = Number(process.env.HARNESS_RECOVERY_STALE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RECOVERY_STALE_MS;
}
