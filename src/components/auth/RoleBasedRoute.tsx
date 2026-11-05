import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { Navigate, Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";
import type { UserRole } from "@/types";

interface RoleBasedRouteProps {
  /**
   * The permission key that opens this screen — the normal case.
   *
   * Asking the matrix instead of a role list is what makes an owner's edit
   * mean something: a guard keyed on `store_manager` cannot be changed from
   * Settings, and a custom role has no name to list here at all.
   */
  permission?: string;
  /** Opens the screen when the role holds *any* of these. */
  anyOf?: string[];
  /**
   * @deprecated Kept only while the migration to permission keys finishes; a
   * route that still passes it is checked against the session role.
   */
  allowedRoles?: UserRole[];
  redirectPath?: string;
  children?: React.ReactNode;
}

/**
 * Gate for every authenticated area.
 *
 * Two rules, both learned the hard way:
 *
 * Fail-closed — the previous version rendered the page whenever `role` was
 * `undefined`, which silently let an unresolved session into owner-only
 * screens. A missing role, an unknown role (a custom role deleted out from
 * under a user) or a permission the matrix never heard of all answer "no".
 *
 * Wait, do not guess — `usePermissions()` reads the tenant's settings document.
 * On a deep link that answer is not in hand yet, and bouncing immediately sent
 * people to /mode-select for a screen they *were* allowed to open. So an
 * unresolved matrix renders a spinner, exactly like an unresolved session.
 */
export function RoleBasedRoute({
  permission,
  anyOf,
  allowedRoles,
  redirectPath = "/mode-select",
  children,
}: RoleBasedRouteProps) {
  const { role, isLoading, isAuthenticated } = useAuth();
  const { can, loading: permissionsLoading } = usePermissions();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // No role => cannot prove authorisation => treat as unauthorised.
  if (!role) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(role)) {
    return <Navigate to={redirectPath} replace />;
  }

  const keys = permission ? [permission] : anyOf;
  if (keys && keys.length > 0) {
    if (permissionsLoading) {
      return (
        <div className="flex h-screen w-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      );
    }
    if (!keys.some((key) => can(key))) {
      return <Navigate to={redirectPath} replace />;
    }
  }

  return children ? <>{children}</> : <Outlet />;
}
