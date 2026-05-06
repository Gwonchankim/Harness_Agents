// Model catalog wrapper. Phase 1 responsibilities:
//   - List enabled ModelCatalog rows.
//   - Resolve a model row by id (ID-agnostic — the runtime never hard-codes).
//   - Compute provider-level availability with a 60-second per-provider cache
//     and a 3-second timeout per probe. Catalog reads are NEVER blocked by
//     availability checks — /settings server-renders rows immediately and the
//     client island calls /api/models afterwards.

import { prisma } from '@db/client';

import { checkProviderAvailability } from '@lib/agents/runtime';
import type { AvailabilityResult, ProviderName } from '@lib/providers';
import { isProviderName } from '@lib/providers';

const AVAILABILITY_TTL_MS = 60_000;

interface CacheEntry {
  expiresAt: number;
  result: AvailabilityResult;
}

const availabilityCache = new Map<string, CacheEntry>();

export type ModelCatalogRow = Awaited<ReturnType<typeof listModels>>[number];

export async function listModels() {
  return prisma.modelCatalog.findMany({
    orderBy: [{ provider: 'asc' }, { modelId: 'asc' }],
  });
}

export async function listEnabledModels() {
  return prisma.modelCatalog.findMany({
    where: { enabled: true },
    orderBy: [{ provider: 'asc' }, { modelId: 'asc' }],
  });
}

export async function getModelOrThrow(modelId: string) {
  const row = await prisma.modelCatalog.findUnique({ where: { modelId } });
  if (!row) throw new Error(`ModelCatalog row not found for modelId=${modelId}`);
  return row;
}

/**
 * Like getModelOrThrow, but also rejects rows where enabled=false. Use this on
 * Run creation so the user can't pin a Run to a model that has been disabled.
 */
export async function getEnabledModelOrThrow(modelId: string) {
  const row = await getModelOrThrow(modelId);
  if (!row.enabled) {
    throw new ModelDisabledError(modelId);
  }
  return row;
}

export class ModelDisabledError extends Error {
  constructor(public readonly modelId: string) {
    super(`ModelCatalog row is disabled for modelId=${modelId}`);
    this.name = 'ModelDisabledError';
  }
}

/**
 * Safely narrow a ModelCatalog.provider string to ProviderName. Returns null
 * (rather than throwing) so callers can decide between 503 and 500 mapping.
 */
export function resolveProviderName(value: string): ProviderName | null {
  return isProviderName(value) ? value : null;
}

export class UnknownProviderError extends Error {
  constructor(public readonly provider: string) {
    super(`ModelCatalog provider is not a known runtime provider: ${provider}`);
    this.name = 'UnknownProviderError';
  }
}

/** Provider-level availability with TTL cache. Errors do not propagate. */
export async function getProviderAvailability(provider: string): Promise<AvailabilityResult> {
  const now = Date.now();
  const cached = availabilityCache.get(provider);
  if (cached && cached.expiresAt > now) return cached.result;
  let result: AvailabilityResult;
  try {
    result = await checkProviderAvailability(provider);
  } catch (err) {
    result = {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
    };
  }
  availabilityCache.set(provider, { expiresAt: now + AVAILABILITY_TTL_MS, result });
  return result;
}

/** Compute availability for every distinct provider in the catalog. */
export async function getAvailabilityMap(): Promise<Record<string, AvailabilityResult>> {
  const rows = await prisma.modelCatalog.findMany({
    where: { enabled: true },
    select: { provider: true },
    distinct: ['provider'],
  });
  const entries = await Promise.all(
    rows.map(async (r) => [r.provider, await getProviderAvailability(r.provider)] as const),
  );
  const map: Record<string, AvailabilityResult> = {};
  for (const [provider, result] of entries) {
    map[provider] = result;
  }
  return map;
}

export function clearAvailabilityCacheForTests() {
  availabilityCache.clear();
}

/**
 * Forget the cached availability for a single provider so the next probe runs
 * for real. Call this after a secret save/delete or after an auth-shaped
 * generateObject failure so the UI/runtime sees the new state immediately.
 */
export function invalidateProviderAvailability(provider: string): void {
  availabilityCache.delete(provider);
}
