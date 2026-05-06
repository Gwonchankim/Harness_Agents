// Centralized helpers for the SQLite-fallback JSON columns documented in
// apps/web/prisma/schema.prisma. Prisma 5 + SQLite has no native Json type,
// so any array/object-shaped column is stored as `String` containing
// JSON.stringify content. Every reader/writer should funnel through here so
// the encoding stays consistent.

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (value == null || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseStringArray(value: string | null | undefined): string[] {
  const parsed = parseJson<unknown>(value, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is string => typeof v === 'string');
}
