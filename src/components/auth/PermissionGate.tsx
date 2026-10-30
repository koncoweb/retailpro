import type { ReactNode } from "react";
import { usePermissions } from "@/hooks/use-permissions";

interface PermissionGateProps {
  /** One of the keys declared in `PERMISSION_GROUPS` (`src/config/roles.ts`). */
  permission: string;
  children: ReactNode;
  /** Rendered instead when the role lacks the permission. Defaults to nothing. */
  fallback?: ReactNode;
}

/**
 * Renders `children` only when the signed-in role holds `permission`.
 *
 * Nothing is rendered while the override is still loading, so a button never
 * flashes in and then disappears. See `usePermissions` for the layering rules
 * and for the UI-only limitation.
 */
export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  const { can, loading } = usePermissions();
  if (loading) return <>{fallback}</>;
  return <>{can(permission) ? children : fallback}</>;
}
