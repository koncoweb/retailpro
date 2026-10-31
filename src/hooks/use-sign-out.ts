/**
 * Ending a session for good.
 *
 * Better Auth's cookie is only half of it: the browser also holds the tenant
 * database URL and a full-access token for it in memory (`tenant-session.ts`)
 * plus every row React Query cached while signed in. A logout that only clears
 * the cookie leaves another account signed into the same company database on
 * this tab — which is what `Header.tsx` did before it was removed.
 */
import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { signOut } from "@/lib/auth-client";
import { useTenant } from "@/contexts/TenantContext";

export function useSignOut(): () => Promise<void> {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { clear } = useTenant();

  return useCallback(async () => {
    try {
      await signOut();
    } catch {
      // The cookie may already be gone (expired session, second click); the
      // local cleanup below is what actually stops this tab.
    }
    clear();
    queryClient.setQueryData(["auth-session"], null);
    queryClient.clear();
    navigate("/login", { replace: true });
  }, [clear, navigate, queryClient]);
}
