import { useAuth } from "@/hooks/use-auth";
import { UserRole } from "@/types";
import { Navigate, Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";

interface RoleBasedRouteProps {
  allowedRoles: UserRole[];
  redirectPath?: string;
  children?: React.ReactNode;
}

/**
 * Role gate for every authenticated area.
 *
 * Fail-closed by design: the previous version rendered the page whenever `role`
 * was `undefined`, which silently let an unresolved session into owner-only
 * screens. Now a missing role is treated the same as a wrong role.
 */
export function RoleBasedRoute({
  allowedRoles,
  redirectPath = "/mode-select",
  children,
}: RoleBasedRouteProps) {
  const { role, isLoading, isAuthenticated } = useAuth();

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

  if (!allowedRoles.includes(role)) {
    return <Navigate to={redirectPath} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
