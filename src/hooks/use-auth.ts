import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { UserRole } from "@/types";

export function useAuth() {
  const { data: session, isLoading, error } = useQuery({
    queryKey: ["auth-session"],
    queryFn: async () => {
      const res = await authClient.getSession();
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const user = session?.user;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const role = (user as any)?.role as UserRole | undefined;

  return {
    session,
    user,
    role,
    isLoading,
    error,
    isAuthenticated: !!session?.session,
  };
}
