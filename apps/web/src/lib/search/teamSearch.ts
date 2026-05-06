// Team recall — keyword + tag + domain + history-score weighted ranking over
// the active Team rows in a Project. MVP only: no embeddings.

import { prisma } from '@db/client';

import { parseStringArray } from '@lib/db/json';

export interface TeamScoreBreakdown {
  keywordScore: number;
  tagScore: number;
  domainScore: number;
  historyScore: number;
  total: number;
}

export interface RecalledTeamSummary {
  teamId: string;
  name: string;
  description: string | null;
  domain: string | null;
  tags: string[];
  leadAgentName: string | null;
  agentCount: number;
  score: TeamScoreBreakdown;
}

export interface RecallInput {
  projectId: string;
  prompt: string;
  historyLines: string[];
  /** Optional caller-derived tags (we also derive them from prompt+history). */
  tags?: string[];
  /** Caller-derived 1-2 word domain. */
  domain?: string;
  limit?: number;
}

const STOPWORDS = new Set<string>([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'in', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was',
  'were', 'will', 'with', 'i', 'you', 'me', 'we', 'us', 'they', 'them', 'do',
  'does', 'did', 'so', 'if', 'but', 'not', 'no', 'yes', 'how', 'what', 'why',
  'when', 'where', 'which', 'who', 'whom', 'can', 'could', 'should', 'would',
  'about', 'into', 'over', 'than', 'then', 'there', 'these', 'those',
]);

const W_KEYWORD = 0.4;
const W_TAG = 0.3;
const W_DOMAIN = 0.2;
const W_HISTORY = 0.1;

const HISTORY_NORMALIZE = 5; // rating values 0..5 → 0..1

/**
 * Score and rank Teams in a Project. Empty result on first run (no Teams yet).
 */
export async function recall(input: RecallInput): Promise<RecalledTeamSummary[]> {
  const limit = input.limit ?? 5;
  const teams = await prisma.team.findMany({
    where: { projectId: input.projectId, status: 'active' },
    select: {
      id: true,
      name: true,
      description: true,
      domain: true,
      tags: true,
      score: true,
      leadAgent: { select: { name: true } },
      _count: { select: { agents: true } },
    },
  });
  if (teams.length === 0) return [];

  const requestTokens = tokenize(`${input.prompt} ${input.historyLines.join(' ')}`);
  const requestTags = new Set<string>(input.tags ?? []);
  for (const tag of deriveTagsFromTokens(requestTokens)) requestTags.add(tag);
  const requestDomain = (input.domain ?? '').trim().toLowerCase() || null;

  const ranked = teams
    .map((t) => {
      const teamTokens = tokenize(`${t.name} ${t.description ?? ''}`);
      const teamTags = new Set(parseStringArray(t.tags).map((s) => s.toLowerCase()));
      const teamDomain = (t.domain ?? '').toLowerCase();

      const keywordScore = jaccard(requestTokens, teamTokens);
      const tagScore = jaccard(requestTags, teamTags);
      const domainScore = requestDomain && requestDomain === teamDomain ? 1 : 0;
      const historyScore = clamp01((t.score ?? 0) / HISTORY_NORMALIZE);

      const total =
        W_KEYWORD * keywordScore +
        W_TAG * tagScore +
        W_DOMAIN * domainScore +
        W_HISTORY * historyScore;

      const summary: RecalledTeamSummary = {
        teamId: t.id,
        name: t.name,
        description: t.description,
        domain: t.domain,
        tags: parseStringArray(t.tags),
        leadAgentName: t.leadAgent?.name ?? null,
        agentCount: t._count.agents,
        score: { keywordScore, tagScore, domainScore, historyScore, total },
      };
      return summary;
    })
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, limit);

  return ranked;
}

// ----------------------------------------------------------------------------
// Pure helpers — exported for tests
// ----------------------------------------------------------------------------

export function tokenize(input: string): Set<string> {
  const tokens = new Set<string>();
  for (const raw of input.toLowerCase().split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    if (raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    tokens.add(raw);
  }
  return tokens;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const v of a) {
    if (b.has(v)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

export function clamp01(n: number): number {
  if (Number.isNaN(n) || n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Derive a tiny tag set from the leading non-stopword tokens. */
export function deriveTagsFromTokens(tokens: Set<string>, maxTags = 5): string[] {
  return Array.from(tokens).slice(0, maxTags);
}

/**
 * Pure scoring entrypoint used by tests so we don't have to mock Prisma. Same
 * weighting as `recall` above.
 */
export interface RankableTeam {
  id: string;
  name: string;
  description: string | null;
  domain: string | null;
  tags: readonly string[];
  score: number | null;
  leadAgentName: string | null;
  agentCount: number;
}

export function scoreTeams(
  request: { prompt: string; historyLines: readonly string[]; domain?: string | null; tags?: readonly string[] },
  teams: readonly RankableTeam[],
  limit = 5,
): RecalledTeamSummary[] {
  if (teams.length === 0) return [];
  const requestTokens = tokenize(`${request.prompt} ${request.historyLines.join(' ')}`);
  const requestTags = new Set<string>(request.tags ?? []);
  for (const tag of deriveTagsFromTokens(requestTokens)) requestTags.add(tag);
  const requestDomain = (request.domain ?? '').trim().toLowerCase() || null;

  return teams
    .map<RecalledTeamSummary>((t) => {
      const teamTokens = tokenize(`${t.name} ${t.description ?? ''}`);
      const teamTags = new Set(t.tags.map((s) => s.toLowerCase()));
      const teamDomain = (t.domain ?? '').toLowerCase();

      const keywordScore = jaccard(requestTokens, teamTokens);
      const tagScore = jaccard(requestTags, teamTags);
      const domainScore = requestDomain && requestDomain === teamDomain ? 1 : 0;
      const historyScore = clamp01((t.score ?? 0) / HISTORY_NORMALIZE);

      const total =
        W_KEYWORD * keywordScore +
        W_TAG * tagScore +
        W_DOMAIN * domainScore +
        W_HISTORY * historyScore;

      return {
        teamId: t.id,
        name: t.name,
        description: t.description,
        domain: t.domain,
        tags: [...t.tags],
        leadAgentName: t.leadAgentName,
        agentCount: t.agentCount,
        score: { keywordScore, tagScore, domainScore, historyScore, total },
      };
    })
    .sort((a, b) => b.score.total - a.score.total)
    .slice(0, limit);
}
