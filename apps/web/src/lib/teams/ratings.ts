// Pure rating aggregation for the team library / team detail surfaces. No I/O —
// callers pass rows fetched from AgentRating / FeedbackBatch and get back simple
// averages. Kept separate from lib/feedback/aggregate.ts (which WRITES Team.score)
// so the read path stays side-effect free.

export interface AgentRatingRow {
  agentId: string;
  rating: number;
}

export interface AgentRatingSummary {
  avg: number;
  count: number;
}

/** Average + count of ratings, grouped by agentId. */
export function aggregateAgentRatings(
  rows: readonly AgentRatingRow[],
): Map<string, AgentRatingSummary> {
  const acc = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const prev = acc.get(row.agentId) ?? { sum: 0, count: 0 };
    prev.sum += row.rating;
    prev.count += 1;
    acc.set(row.agentId, prev);
  }
  const out = new Map<string, AgentRatingSummary>();
  for (const [agentId, { sum, count }] of acc) {
    out.set(agentId, { avg: round2(sum / count), count });
  }
  return out;
}

/** Mean of a number list rounded to 2 dp, or null when empty. */
export function averageOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((s, v) => s + v, 0);
  return round2(sum / values.length);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
