// Team score aggregation. Recomputes Team.score as the running average of all
// result ratings + per-agent ratings recorded for the team. Per the PLAN policy,
// feedback only nudges the score — it never auto-rewrites agents.

import { prisma } from '@db/client';

export async function recomputeTeamScore(teamId: string): Promise<number | null> {
  const [resultBatches, agentRatings] = await Promise.all([
    prisma.feedbackBatch.findMany({
      where: { run: { teamId }, resultRating: { not: null } },
      select: { resultRating: true },
    }),
    prisma.agentRating.findMany({
      where: { agent: { teamId } },
      select: { rating: true },
    }),
  ]);

  const values: number[] = [];
  for (const b of resultBatches) {
    if (b.resultRating != null) values.push(b.resultRating);
  }
  for (const r of agentRatings) values.push(r.rating);

  if (values.length === 0) return null;

  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  const score = Math.round(avg * 100) / 100;
  await prisma.team.update({ where: { id: teamId }, data: { score } });
  return score;
}
