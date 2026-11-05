/**
 * One resolver for "what may this person do, and where".
 *
 * RetailPro used to answer that question in three disagreeing places: the
 * `usePermissions()` hook (which honoured the tenant's saved matrix), the
 * `roleHasPermission()` helpers in `branch-orders.ts` / `procurement.ts` (which
 * read the shipped defaults only), and hard-coded role arrays sprinkled through
 * the pages. A permission could be switched off in Settings and still be
 * enforced as though it were on.
 *
 * Everything now comes from this file: `src/config/roles.ts` supplies the
 * catalog and the shipped defaults, `tenants.settings` supplies what the owner
 * changed, and the result is one map of role key -> grant.
 *
 * Deliberately free of React and of SQL, the same discipline `src/lib/
 * stock-issue.ts` and `src/lib/branch-orders.ts` follow for their domains. The
 * server imports these types too (`server/roles.ts`), so it must stay pure.
 */
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_LABELS,
  ROLES,
  resolveRolePermissions,
  type RoleValue,
} from "@/config/roles";

/** Custom role keys are namespaced so they can never collide with a builtin. */
export const CUSTOM_ROLE_PREFIX = "cust_";

/**
 * TanStack Query key holding this tenant's resolved grants.
 *
 * Lives here, next to the resolver that produces the value, because
 * `/api/tenant/bootstrap` seeds it and `TenantContext` reads it: importing the
 * key from a React module would make the context import the hook that imports
 * the context.
 */
export const TENANT_SETTINGS_QUERY_KEY = ["tenant-settings"];

/** What the query holds: every role of the tenant, already resolved. */
export type RoleGrants = Record<string, RoleGrant>;

export function isCustomRoleKey(key: string): boolean {
  return key.startsWith(CUSTOM_ROLE_PREFIX);
}

/** `branches: 'all'` until an owner says otherwise — never narrow by accident. */
export type ScopeTarget = "all" | string[];

export interface RoleScope {
  branches: ScopeTarget;
  warehouses: ScopeTarget;
}

export const FULL_SCOPE: RoleScope = { branches: "all", warehouses: "all" };

/** What an owner typed in for a role of their own. */
export interface CustomRoleDefinition {
  label: string;
  description?: string;
  /** Builtin role whose shipped defaults this one starts from. */
  clone_of?: string | null;
  /**
   * The builtin role Better Auth is handed at creation time. The plugin
   * validates `role` against a static list, so the custom key is written
   * straight afterwards by the admin endpoint and never travels through the
   * plugin.
   */
  auth_tier?: string;
  permissions?: Record<string, boolean>;
  scope?: Partial<RoleScope>;
  created_at?: string;
}

/** The settings document, restricted to the three keys this resolver reads. */
export interface RoleSettings {
  role_permissions?: Record<string, Record<string, boolean>> | null;
  custom_roles?: Record<string, CustomRoleDefinition> | null;
  role_scopes?: Record<string, Partial<RoleScope>> | null;
}

/** A role as the app actually experiences it. */
export interface RoleGrant {
  key: string;
  label: string;
  description: string;
  builtin: boolean;
  /** Every catalog key the role holds, already merged with the tenant's edits. */
  permissions: Record<string, boolean>;
  scope: RoleScope;
}

/**
 * The legacy `admin` role has no entry of its own in the matrix; it has always
 * meant `tenant_admin`. Both former copies of this function were private and
 * differed from the hook in everything but name.
 */
export function permissionRole(role: string | null | undefined): string | null {
  if (!role) return null;
  if (role === "admin") return "tenant_admin";
  return role;
}

export function isBuiltinRole(key: string): boolean {
  return (ROLES as readonly { value: string }[]).some((r) => r.value === key);
}

function normalizeScope(scope: Partial<RoleScope> | null | undefined): RoleScope {
  return {
    branches: Array.isArray(scope?.branches) ? scope?.branches.map(String) : "all",
    warehouses: Array.isArray(scope?.warehouses) ? scope?.warehouses.map(String) : "all",
  };
}

/** A stored `false` beats a default `true`; anything else is not a decision. */
function pickBooleans(
  source: Record<string, boolean> | null | undefined
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
}

/**
 * Every role this tenant has — builtin plus the owner's own — fully resolved.
 *
 * Merge order, lowest first:
 *   1. shipped defaults for the role,
 *   2. the tenant's override for that role (`role_permissions`),
 *   3. for a custom role, its own permission set laid over the `clone_of`
 *      defaults.
 *
 * Step 3 is why a custom role keeps working after an upgrade: keys that shipped
 * after the role was made fall back to the base role's default instead of
 * vanishing, and the owner still has to switch them on if the base lacked them.
 */
export function buildGrants(settings: RoleSettings | null | undefined): Record<string, RoleGrant> {
  const grants: Record<string, RoleGrant> = {};
  const overrides = settings?.role_permissions ?? {};
  const scopeOverrides = settings?.role_scopes ?? {};

  for (const role of ROLES) {
    const value = role.value as RoleValue;
    grants[value] = {
      key: value,
      label: role.label,
      description: role.description,
      builtin: true,
      permissions: resolveRolePermissions(value, pickBooleans(overrides[value])),
      scope: normalizeScope(scopeOverrides[value]),
    };
  }

  // The alias has to exist as its own entry: the session of an account created
  // before the rename still carries the literal string `admin`.
  const legacy = grants["tenant_admin"];
  if (legacy) {
    grants["admin"] = { ...legacy, key: "admin" };
  }

  for (const [key, custom] of Object.entries(settings?.custom_roles ?? {})) {
    if (!key || !custom || typeof custom !== "object") continue;
    const baseKey = permissionRole(custom.clone_of ?? null);
    const base =
      baseKey && DEFAULT_ROLE_PERMISSIONS[baseKey as RoleValue]
        ? DEFAULT_ROLE_PERMISSIONS[baseKey as RoleValue]
        : {};
    // The same three-layer order as above, and `role_permissions[key]` is read
    // for a custom key as well: an owner who once switched a role's permissions
    // around wrote to whichever map the editor of the day used, and the last
    // word always belongs to the custom role's own definition.
    grants[key] = {
      key,
      label: custom.label || key,
      description: custom.description ?? "",
      builtin: false,
      permissions: { ...base, ...pickBooleans(overrides[key]), ...pickBooleans(custom.permissions) },
      scope: normalizeScope(custom.scope ?? scopeOverrides[key]),
    };
  }

  return grants;
}

/** The resolved grant for a session role. `undefined` means "unknown role". */
export function grantForRole(
  grants: Record<string, RoleGrant>,
  role: string | null | undefined
): RoleGrant | undefined {
  const key = permissionRole(role);
  if (!key) return undefined;
  return grants[key];
}

/**
 * The permission map of one grant, fail-closed.
 *
 * An unknown key is what happens when a custom role is deleted out from under a
 * user. Returning `{}` locks them out of every gated control, which is the
 * same posture `RoleBasedRoute` takes and is explainable through the mode
 * chooser's "hubungi owner" panel — guessing a default is not.
 */
export function effectivePermissions(
  grant: RoleGrant | null | undefined
): Record<string, boolean> {
  return grant?.permissions ?? {};
}

/** A `can()` predicate, the signature `branch-orders.ts` and `procurement.ts` want. */
export type PermissionCheck = (permission: string) => boolean;

export function makeChecker(
  grant: RoleGrant | null | undefined
): PermissionCheck {
  const permissions = effectivePermissions(grant);
  return (permission: string) => permissions[permission] === true;
}

/**
 * Is a location inside a role's scope?
 *
 * Rows without a location at all (a company-wide warehouse, a head-office
 * figure) only appear for an `'all'` scope: a scoped role is asking "what is
 * happening at my place", and an unlocated row is not at their place.
 */
export function inScope(scope: ScopeTarget | undefined, id?: string | null): boolean {
  if (!scope || scope === "all") return true;
  if (!id) return false;
  return scope.includes(id);
}

export function branchInScope(scope: RoleScope | undefined, id?: string | null): boolean {
  return inScope(scope?.branches, id);
}

export function warehouseInScope(scope: RoleScope | undefined, id?: string | null): boolean {
  return inScope(scope?.warehouses, id);
}

/** Ids a scope pins down, or `null` when it does not pin anything. */
export function scopeIds(scope: ScopeTarget | undefined): string[] | null {
  return Array.isArray(scope) ? scope : null;
}

/**
 * Which branches a person actually works across.
 *
 * Three inputs, in this order:
 *   1. an explicit `role_scopes` / custom-role list wins — that is the owner
 *      answering the "where" question on purpose;
 *   2. a company-wide role (the one that may edit company settings: owner and
 *      admin) is not tied to a branch at all;
 *   3. everybody else sees the branch they belong to, which is what a store
 *      manager has always been limited to and what a cashier now is too.
 *
 * Returns `null` for "unrestricted", so a caller can keep writing
 * `if (branchIds && !branchIds.includes(id)) …`.
 */
export function effectiveBranchScope(params: {
  scope: RoleScope | undefined;
  assignedBranchId?: string | null;
  companyWide?: boolean;
}): string[] | null {
  const explicit = scopeIds(params.scope?.branches);
  if (explicit) return explicit;
  if (params.companyWide) return null;
  return params.assignedBranchId ? [params.assignedBranchId] : null;
}

/** The same question for gudang, which are never implied by an assignment. */
export function effectiveWarehouseScope(scope: RoleScope | undefined): string[] | null {
  return scopeIds(scope?.warehouses);
}

/** Label for a permission key, falling back to the key so nothing renders blank. */
export function permissionLabel(key: string): string {
  return PERMISSION_LABELS[key] ?? key;
}

/** Every catalog key, so a UI can iterate without importing the group shape. */
export function allPermissionKeys(): string[] {
  return ALL_PERMISSION_KEYS;
}
