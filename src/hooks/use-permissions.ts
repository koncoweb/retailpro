import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { DEFAULT_ROLE_PERMISSIONS, resolveRolePermissions, type RoleValue } from "@/config/roles";
import { readTenantSetting } from "@/lib/tenant-settings";

/**
 * Effective permissions for the signed-in role.
 *
 * The matrix has two layers, and the settings screen only ever writes the
 * upper one:
 *   1. `tenants.settings.role_permissions` — an override an owner may edit in
 *      Settings -> Role (`EmployeeRoleSettings` writes exactly this shape),
 *   2. `DEFAULT_ROLE_PERMISSIONS` — the shipped default for the role.
 *
 * Before this hook existed the matrix was configured and displayed but read by
 * nothing, so every button was visible to every role that reached the page.
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
  /** True until the override has been read, so gates can stay hidden. */
  loading: boolean;
  role: string | null | undefined;
}

type PermissionMatrix = Record<string, Record<string, boolean>>;

/** The legacy `admin` role has no entry in the matrix of its own. */
function matrixRole(role: string | null | undefined): RoleValue | null {
  if (!role) return null;
  if (role === "admin") return "tenant_admin";
  return role in DEFAULT_ROLE_PERMISSIONS ? (role as RoleValue) : null;
}

export function usePermissions(): PermissionsApi {
  const { user, role } = useAuth();
  const [overrides, setOverrides] = useState<PermissionMatrix | null>(null);

  useEffect(() => {
    let cancelled = false;
    readTenantSetting<PermissionMatrix>("role_permissions", {})
      .then((value) => {
        if (!cancelled) setOverrides(value && typeof value === "object" ? value : {});
      })
      .catch(() => {
        // A read failure must not lock people out of the screen they can see:
        // fall back to the shipped defaults.
        if (!cancelled) setOverrides({});
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const key = useMemo(() => matrixRole(user?.role ?? null), [user?.role]);

  const granted = useMemo<Record<string, boolean>>(() => {
    if (!key) return {};
    // Merge, never replace: an override saved before a permission shipped has
    // no key for it, and that permission must keep its default.
    return resolveRolePermissions(key, overrides?.[key]);
  }, [key, overrides]);

  const loading = overrides === null;

  const can = useCallback(
    (permission: string) => (loading ? false : granted[permission] === true),
    [granted, loading]
  );

  return { can, granted, loading, role };
}

/** Convenience for a single check without destructuring the object. */
export function usePermission(permission: string): boolean {
  const { can } = usePermissions();
  return can(permission);
}
