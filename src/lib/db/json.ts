/**
 * JSON1 column helpers.
 *
 * `json_group_array()` / `json_group_object()` return **TEXT**, never objects.
 * Every call site that used to receive a parsed Postgres `json`/`jsonb` value
 * must run the column through `parseJson()` — this is the single most likely
 * source of silent breakage in the migration.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseJson<T = any>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string') return fallback;

  const trimmed = value.trim();
  if (trimmed === '') return fallback;

  try {
    const parsed = JSON.parse(trimmed);
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/** `parseJson(value, [])` shorthand for aggregate columns. */
export function parseJsonArray<T = any>(value: unknown): T[] {
  const parsed = parseJson<T[]>(value, []);
  return Array.isArray(parsed) ? parsed : [];
}

/** `parseJson(value, {})` shorthand for object aggregates. */
export function parseJsonObject<T = any>(value: unknown): Record<string, T> {
  const parsed = parseJson<Record<string, T>>(value, {});
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}
