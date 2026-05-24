// In-process pub/sub for run events. One Next worker / one process. SSE route
// subscribes; the executor publishes via lib/events/append.ts.

import { EventEmitter } from 'node:events';

export interface RunEventEnvelope {
  id: string;
  runId: string;
  taskId: string | null;
  agentId: string | null;
  type: string;
  payload: unknown;
  createdAt: string; // ISO
}

const buses = new Map<string, EventEmitter>();

export function getRunBus(runId: string): EventEmitter {
  let bus = buses.get(runId);
  if (!bus) {
    bus = new EventEmitter();
    bus.setMaxListeners(20);
    buses.set(runId, bus);
  }
  return bus;
}

export function publishRunEvent(runId: string, event: RunEventEnvelope): void {
  const bus = buses.get(runId);
  if (!bus) return;
  bus.emit('event', event);
}

export function subscribeRunEvents(
  runId: string,
  handler: (event: RunEventEnvelope) => void,
): () => void {
  const bus = getRunBus(runId);
  bus.on('event', handler);
  return () => {
    bus.off('event', handler);
    if (bus.listenerCount('event') === 0) {
      buses.delete(runId);
    }
  };
}

// ---------------------------------------------------------------------------
// Cancellation: per-run AbortController registry. The /start route registers a
// controller before fire-and-forgetting the executor and clears it when the
// executor settles; the /cancel route (via lib/runs/cancel.ts) aborts it. Single
// process / one Next worker, so a plain Map is enough. Across a process restart
// the controllers are gone — the executor is gone too, and the recovery sweep
// handles any run left in planning/running.
// ---------------------------------------------------------------------------

const controllers = new Map<string, AbortController>();

export function registerRunController(runId: string, controller: AbortController): void {
  controllers.set(runId, controller);
}

export function getRunController(runId: string): AbortController | undefined {
  return controllers.get(runId);
}

/** Abort the in-process executor for a run. Returns false if none is registered. */
export function abortRun(runId: string): boolean {
  const controller = controllers.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function clearRunController(runId: string): void {
  controllers.delete(runId);
}
