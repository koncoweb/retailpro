import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { readTenantRoleSettings } from "@/lib/tenant-settings";
import {
  buildGrants,
  effectiveBranchScope,
  effectivePermissions,
  effectiveWarehouseScope,
  grantForRole,
  TENANT_SETTINGS_QUERY_KEY,
  type RoleGrant,
  type RoleGrants,
  type RoleScope,
} from "@/lib/permission-matrix";

/** Re-exported so a consumer can type a grant without importing two modules. */
export type { RoleGrant, RoleGrants } from "@/lib/permission-matrix";

/**
 * Effective permissions for the signed-in role, resolved in one place.
 *
 * The matrix has three layers, and only the lower two are editable by an owner:
 *   1. `DEFAULT_ROLE_PERMISSIONS` — the shipped default for the role,
 *   2. `tenants.settings.role_permissions` — an override for a builtin role,
 *   3. `tenants.settings.custom_roles` — a role the owner invented.
 *
 * All three are merged by `buildGrants()` in `src/lib/permission-matrix.ts`,
 * which is also what the server runs when it answers `/api/tenant/bootstrap`.
 * There is deliberately no second resolver, and the query caches *resolved
 * grants* rather than the raw document, so a browser that booted from the
 * bootstrap payload and one that booted from a settings read cannot disagree.
 *
 * Read through TanStack Query, not a per-component effect: a page with six
 * gated buttons used to fire six `SELECT settings FROM tenants LIMIT 1` on
 * mount. One shared query also means one invalidation after a matrix save.
 *
 * NOTE: this is a UI-level gate. The browser holds a full-access token for the
 * tenant database, so a determined user can still write directly. There is no
 * row-level security on tenant data; closing that is a platform change
 * (docs/spec-purchase-order.md §15).
 */
export interface PermissionsApi {
  /** True only for a permission the role actually holds. */
  can: (permission: string) => boolean;
  /** The raw granted set, useful for building a filter predicate once. */
  granted: Record<string, boolean>;
  /** Where this role's answer applies: which branches and which gudang. */
  scope: RoleScope;
  /** True until the answer is known, so gates can stay hidden. */
  loading: boolean;
  role: string | null | undefined;
  /** What the role is called, including a custom role's own label. */
  roleLabel: string;
  /** The whole resolved grant, for screens that need its description too. */
  grant: RoleGrant | undefined;
  /** Every role of this tenant, resolved — the Role screen and the preview. */
  grants: RoleGrants;
}

export function useTenantGrantsQuery() {
  return useQuery<RoleGrants>({
    queryKey: TENANT_SETTINGS_QUERY_KEY,
    // The browser reads the same document the server read to seed this cache,
    // through the same resolver. If it cannot be read at all, fall back to the
    // shipped defaults instead of locking everybody out of their own screen.
    queryFn: async () => {
      try {
        return buildGrants(await readTenantRoleSettings());
      } catch (error) {
        console.warn("[permissions] settings read failed, using shipped defaults", error);
        return buildGrants(null);
      }
    },
    staleTime: 60_000,
    retry: 1,
  });
}

export function usePermissions(): PermissionsApi {
  const { user, role } = useAuth();
  const { data, isLoading } = useTenantGrantsQuery();

  const grants = useMemo<RoleGrants>(() => data ?? {}, [data]);

  const key = user?.role ?? null;
  const grant = useMemo(() => grantForRole(grants, key), [grants, key]);

  const granted = useMemo(() => effectivePermissions(grant), [grant]);
  const scope = grant?.scope ?? { branches: "all", warehouses: "all" };

  // Loading is only true while the very first read is in flight. `bootstrap`
  // seeds this cache, so a normal sign-in never paints an unknown state.
  const loading = isLoading && data === undefined;

  const can = useCallback(
    (permission: string) => (loading ? false : granted[permission] === true),
    [granted, loading]
  );

  return {
    can,
    granted,
    scope,
    loading,
    role,
    roleLabel: grant?.label ?? role ?? "Tanpa Role",
    grant,
    grants,
  };
}

/** Convenience for a single check without destructuring the object. */
export function usePermission(permission: string): boolean {
  const { can } = usePermissions();
  return can(permission);
}

/**
 * Where the signed-in role is allowed to look.
 *
 * Separate export because most screens only filter a list by it and should not
 * re-derive the permission map.
 */
export function useRoleScope(): { scope: RoleScope; loading: boolean } {
  const { scope, loading } = usePermissions();
  return { scope, loading };
}

/**
 * Call after writing the settings document so every gate updates at once.
 *
 * A matrix save must not need a page reload — that was the second half of the
 * "saved but nothing changed" complaint the Role screen used to answer with F5.
 */
export function useInvalidateTenantSettings() {
  const queryClient = useQueryClient();
  return useCallback(
    () => queryClient.invalidateQueries({ queryKey: TENANT_SETTINGS_QUERY_KEY }),
    [queryClient]
  );
}

/**
 * The branches the signed-in person works across, or `null` for "semua".
 *
 * Screens filter *out* the rows outside this list rather than disabling them,
 * and each prints `sentence` so the omission is explainable instead of looking
 * like missing data.
 */
export function useBranchScope(): {
  branchIds: string[] | null;
  loading: boolean;
  restricted: boolean;
} {
  const { user } = useAuth();
  const { scope, can, loading } = usePermissions();
  const branchIds = useMemo(
    () =>
      effectiveBranchScope({
        scope,
        assignedBranchId: user?.assigned_branch_id ?? null,
        // Owner and admin are the company-wide roles; everybody else works from
        // the branch they are assigned to unless a scope says otherwise.
        companyWide: can("view_settings"),
      }),
    [scope, user?.assigned_branch_id, can]
  );
  return { branchIds, loading, restricted: branchIds !== null };
}

/** The same answer for gudang. */
export function useWarehouseScope(): {
  warehouseIds: string[] | null;
  loading: boolean;
  restricted: boolean;
} {
  const { scope, loading } = usePermissions();
  const warehouseIds = useMemo(() => effectiveWarehouseScope(scope), [scope]);
  return { warehouseIds, loading, restricted: warehouseIds !== null };
}
