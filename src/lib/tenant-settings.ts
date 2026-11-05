import { parseJson, query, runTransaction } from "@/lib/db";
import {
  normalizeStockIssueMethod,
  STOCK_ISSUE_METHOD_FIELD,
  STOCK_ISSUE_SETTING_KEY,
  type StockIssueMethod,
} from "@/lib/stock-issue";
import type { RoleSettings, UserPermissionOverrides } from "@/lib/permission-matrix";

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

/**
 * Write one top-level key *verbatim*, deleting it when the value is `undefined`.
 *
 * `mergeTenantSettings` cannot express a removal: its one-level merge spreads the
 * existing object, so a `custom_roles` patch that leaves out a key keeps the
 * stored role exactly where it was. Deleting a role, or resetting a scope to
 * "semua", needs the replaced value instead.
 */
export async function replaceTenantSetting(key: string, value: unknown): Promise<void> {
  await runTransaction(async (tx) => {
    const res = await tx.query<{ id: string; settings: string | null }>(
      `SELECT id, settings FROM tenants LIMIT 1`
    );
    const row = res.rows[0];
    if (!row) return;

    const merged = parseJson<TenantSettings>(row.settings, {});
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }

    await tx.execute(`UPDATE tenants SET settings = $1 WHERE id = $2`, [
      JSON.stringify(merged),
      row.id,
    ]);
  });
}

/** Convenience: read one top-level key with a typed fallback. */
export async function readTenantSetting<T>(key: string, fallback: T): Promise<T> {
  const settings = await readTenantSettings();
  const value = settings[key];
  return (value === undefined || value === null ? fallback : value) as T;
}

/** The keys the permission matrix owns. Nothing else reads them raw. */
export const ROLE_SETTING_KEYS = [
  "role_permissions",
  "custom_roles",
  "role_scopes",
  "user_permissions",
] as const;

/**
 * The role slice of the settings document, on its own.
 *
 * `usePermissions()` caches exactly this, and `/api/tenant/bootstrap` returns
 * the same keys, so the cached value is never a half-read of a document
 * that also carries payroll or receipt data.
 */
export function pickRoleSettings(settings: TenantSettings): RoleSettings {
  const picked: Record<string, unknown> = {};
  for (const key of ROLE_SETTING_KEYS) {
    const value = settings[key];
    if (value !== undefined && value !== null) picked[key] = value;
  }
  // The keys are the only ones `RoleSettings` declares; `buildGrants()` sorts
  // out whatever shapes they actually hold, so nothing is trusted here.
  return picked as RoleSettings;
}

export async function readTenantRoleSettings(): Promise<RoleSettings> {
  return pickRoleSettings(await readTenantSettings());
}

/**
 * The per-employee permission exceptions, as stored.
 *
 * Read whole (every user) so the Employees screen can show and edit any one
 * person's overrides; `usePermissions()` picks out only the signed-in id. The
 * shape is not trusted: `effectiveUserPermissions()` sorts out which values
 * actually mean anything, and only `false` ever does.
 */
export async function readTenantUserPermissions(): Promise<UserPermissionOverrides> {
  const settings = await readTenantSettings();
  const value = settings.user_permissions;
  return value && typeof value === "object" ? (value as UserPermissionOverrides) : {};
}

/**
 * Replace one employee's exceptions, pruning the entry when it becomes empty.
 *
 * Read-modify-write of the whole `user_permissions` map through
 * `replaceTenantSetting`, the same discipline the Role screen follows for
 * `custom_roles`: an empty override set is deleted rather than stored as `{}`.
 * The caller passes only the keys set to `false` (restrict-only); nothing here
 * can express a permission the role does not already grant.
 */
export async function setUserPermissionOverrides(
  userId: string,
  restrictions: Record<string, boolean>
): Promise<void> {
  const all = await readTenantUserPermissions();
  const kept = Object.fromEntries(
    Object.entries(restrictions ?? {}).filter(([, value]) => value === false)
  );
  if (Object.keys(kept).length) {
    all[userId] = kept;
  } else {
    delete all[userId];
  }
  await replaceTenantSetting(
    "user_permissions",
    Object.keys(all).length ? all : undefined
  );
}

/** Drop an employee's exceptions when their account is deleted. */
export async function clearUserPermissionOverrides(userId: string): Promise<void> {
  const all = await readTenantUserPermissions();
  if (!(userId in all)) return;
  delete all[userId];
  await replaceTenantSetting(
    "user_permissions",
    Object.keys(all).length ? all : undefined
  );
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
