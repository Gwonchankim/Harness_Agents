// Pure topological sort + cycle/duplicate/missing-dependency detection over
// (taskKey, dependencies[]) pairs. Used at Lead-plan validation time and at
// execute-time. No Prisma, no I/O — fully unit-testable.

export interface TaskNode {
  taskKey: string;
  dependencies: readonly string[];
}

export class CycleDetectedError extends Error {
  constructor(public readonly cycle: readonly string[]) {
    super(`cycle_detected: ${cycle.join(' -> ')}`);
    this.name = 'CycleDetectedError';
  }
}

export class MissingDependencyError extends Error {
  constructor(
    public readonly taskKey: string,
    public readonly missing: string,
  ) {
    super(`missing_dependency: ${taskKey} depends on unknown ${missing}`);
    this.name = 'MissingDependencyError';
  }
}

export class DuplicateTaskKeyError extends Error {
  constructor(public readonly taskKey: string) {
    super(`duplicate_task_key: ${taskKey}`);
    this.name = 'DuplicateTaskKeyError';
  }
}

/**
 * Returns the tasks in a valid execution order. Throws on cycle, duplicate, or
 * missing dependency. Stable: ties (same level) preserve input order.
 */
export function topoSort<T extends TaskNode>(tasks: readonly T[]): T[] {
  const byKey = new Map<string, T>();
  for (const t of tasks) {
    if (byKey.has(t.taskKey)) throw new DuplicateTaskKeyError(t.taskKey);
    byKey.set(t.taskKey, t);
  }
  for (const t of tasks) {
    for (const dep of t.dependencies) {
      if (!byKey.has(dep)) throw new MissingDependencyError(t.taskKey, dep);
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const ordered: T[] = [];

  function visit(key: string): void {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      const cycleStart = stack.indexOf(key);
      const cycle = stack.slice(cycleStart >= 0 ? cycleStart : 0).concat(key);
      throw new CycleDetectedError(cycle);
    }
    visiting.add(key);
    stack.push(key);
    const node = byKey.get(key)!;
    for (const dep of node.dependencies) visit(dep);
    visiting.delete(key);
    stack.pop();
    visited.add(key);
    ordered.push(node);
  }

  for (const t of tasks) visit(t.taskKey);
  return ordered;
}
