// Model catalog wrapper. Phase 1 responsibilities:
//   - List enabled ModelCatalog rows.
//   - Resolve a model row by id (ID-agnostic — the runtime never hard-codes).
//   - Compute provider-level availability with a 60-second per-provider cache
//     and a 3-second timeout per probe. Catalog reads are NEVER blocked by
//     availability checks — /settings server-renders rows immediately and the
//     client island calls /api/models afterwards.

import { prisma } from '@db/client';

import { checkProviderAvailability } from '@lib/agents/runtime';
import type { AvailabilityResult } from '@lib/providers';

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
