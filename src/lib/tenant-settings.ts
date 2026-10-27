import { parseJson, query, runTransaction } from "@/lib/db";
import {
  normalizeStockIssueMethod,
  STOCK_ISSUE_METHOD_FIELD,
  STOCK_ISSUE_SETTING_KEY,
  type StockIssueMethod,
} from "@/lib/stock-issue";

/**
 * Tenant settings live in a single JSON column (`tenants.settings`).
 *
 * libSQL has no `jsonb_set`, so writes are a read → merge → write performed
 * inside one transaction. The shape mirrors what the settings screens already
 * read: `role_permissions`, `payroll_config`, `receipt`, `tax`, `bank`, …
 */
export type TenantSettings = Record<string, unknown>;

/** Read the merged settings object. Returns `{}` when nothing is stored yet. */
export async function readTenantSettings<T extends TenantSettings = TenantSettings>(): Promise<T> {
  const res = await query<{ id: string; settings: string | null }>(
    `SELECT id, settings FROM tenants LIMIT 1`
  );
  const row = res.rows[0];
  if (!row) return {} as T;
  return parseJson<T>(row.settings, {} as T);
}

/**
 * Deep-merge `patch` into the stored settings. Top-level keys are replaced;
 * plain objects are merged one level deep so a screen can update
 * `role_permissions` without clobbering `payroll_config`.
 */
export async function mergeTenantSettings(patch: TenantSettings): Promise<void> {
  await runTransaction(async (tx) => {
    const res = await tx.query<{ id: string; settings: string | null }>(
      `SELECT id, settings FROM tenants LIMIT 1`
    );
    const row = res.rows[0];
    if (!row) return;

    const current = parseJson<TenantSettings>(row.settings, {});
    const merged: TenantSettings = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      const existing = merged[key];
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        existing &&
        typeof existing === "object" &&
        !Array.isArray(existing)
      ) {
        merged[key] = { ...(existing as TenantSettings), ...(value as TenantSettings) };
      } else {
        merged[key] = value;
      }
    }

    await tx.execute(`UPDATE tenants SET settings = $1 WHERE id = $2`, [
      JSON.stringify(merged),
      row.id,
    ]);
  });
}

/** Replace one top-level key of the settings document. */
export async function setTenantSetting(key: string, value: unknown): Promise<void> {
  await mergeTenantSettings({ [key]: value });
}

/** Convenience: read one top-level key with a typed fallback. */
export async function readTenantSetting<T>(key: string, fallback: T): Promise<T> {
  const settings = await readTenantSettings();
  const value = settings[key];
  return (value === undefined || value === null ? fallback : value) as T;
}

/**
 * Which batch the system issues when stock leaves a warehouse.
 *
 * Read *before* a write transaction opens: the deduction loops sort in memory,
 * so every stock-out path needs the method in hand rather than a second query
 * inside the transaction.
 */
export async function getStockIssueMethod(): Promise<StockIssueMethod> {
  const inventory = await readTenantSetting<Record<string, unknown> | null>(
    STOCK_ISSUE_SETTING_KEY,
    null
  );
  return normalizeStockIssueMethod(inventory?.[STOCK_ISSUE_METHOD_FIELD]);
}
