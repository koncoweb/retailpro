import { useAuth } from "@/hooks/use-auth";
import { UserRole } from "@/types";
import { Navigate, Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";

interface RoleBasedRouteProps {
  allowedRoles: UserRole[];
  redirectPath?: string;
  children?: React.ReactNode;
}

export function RoleBasedRoute({ 
  allowedRoles, 
  redirectPath = "/backoffice", 
  children 
}: RoleBasedRouteProps) {
  const { role, isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // If not authenticated, let the auth guard handle it (or redirect to login)
  if (!isAuthenticated) {
     // Assuming there's a higher level Auth Guard, but if not:
     return <Navigate to="/login" replace />;
  }

  if (role && !allowedRoles.includes(role)) {
    return <Navigate to={redirectPath} replace />;
  }

  return children ? <>{children}</> : <Outlet />;
}
