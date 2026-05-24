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
