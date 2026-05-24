// Transitive downstream (dependents) of a task in the DAG. Pure, no I/O.
//
// Given (taskKey, dependencies[]) pairs, returns every task that depends on the
// target directly or indirectly. This is the inverse of `dependencies`: if B
// lists A in its dependencies, B is downstream of A.
//
// Phase 8 run-level resume + (failed/cancelled) task-level retry do NOT need this
// (downstream of a failed task is still `pending` in the sequential executor).
// It is the tested groundwork for Phase 9 "force re-run a DONE task", where the
// target's done downstream must be invalidated because their inputs change.

import type { TaskNode } from './topo';

/**
 * Every task transitively downstream of `targetKey` (dependents of dependents…).
 * The target itself is NOT included. Cycle-safe via a visited set.
 */
export function transitiveDownstream(
  tasks: readonly TaskNode[],
  targetKey: string,
): Set<string> {
  const dependents = new Map<string, string[]>();
  for (const t of tasks) {
    for (const dep of t.dependencies) {
      const arr = dependents.get(dep);
      if (arr) arr.push(t.taskKey);
      else dependents.set(dep, [t.taskKey]);
    }
  }

  const result = new Set<string>();
  const queue: string[] = [...(dependents.get(targetKey) ?? [])];
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (result.has(key)) continue;
    result.add(key);
    for (const next of dependents.get(key) ?? []) {
      if (!result.has(next)) queue.push(next);
    }
  }
  return result;
}
