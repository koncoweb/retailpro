import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getSession } from "@/lib/auth-client";
import { UserRole } from "@/types";

/** Better Auth user plus the legacy column names the pages already read. */
export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
  branchId: string | null;
  status: string | null;
  /** Legacy alias of `branchId` (was a column on `users`). */
  assigned_branch_id: string | null;
  /** Legacy alias of `tenantId`. */
  tenant_id: string | null;
  image?: string | null;
}

export function useAuth() {
  const { data: session, isLoading, error } = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const res = await getSession();
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false,
  });

  const sessionUser = session?.user;

  /**
   * `role`, `tenantId` and `branchId` are Better Auth `additionalFields`
   * declared in `server/auth.ts`, so they exist on every session.
   *
   * `assigned_branch_id` / `tenant_id` are kept as aliases because a dozen pages
   * still read the old Postgres column names; with database-per-tenant the tenant
   * id is no longer a column, it is the session scope.
   */
  // Memoised: pages fetch in `useEffect(..., [user])`, so a fresh object every
  // render would re-run the fetch on every render and never settle.
  const user: AppUser | undefined = useMemo(
    () =>
      sessionUser
        ? {
            id: sessionUser.id,
            email: sessionUser.email,
            name: sessionUser.name,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            role: ((sessionUser as any).role as UserRole) ?? "staff",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tenantId: ((sessionUser as any).tenantId as string | null) ?? null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            branchId: ((sessionUser as any).branchId as string | null) ?? null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            status: ((sessionUser as any).status as string | null) ?? null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            assigned_branch_id: ((sessionUser as any).branchId as string | null) ?? null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            tenant_id: ((sessionUser as any).tenantId as string | null) ?? null,
            image: sessionUser.image ?? null,
          }
        : undefined,
    [sessionUser],
  );

  return {
    session,
    user,
    role: user?.role,
    isLoading,
    error,
    isAuthenticated: Boolean(session?.session),
  };
}
