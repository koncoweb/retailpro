/**
 * Better Auth browser client.
 *
 * Preserves the `/api/auth/*` surface the pages already expect (`signIn.email`,
 * `signUp.email`, `signOut`, `getSession`), now served by `server/auth.ts`.
 */
import { createAuthClient } from 'better-auth/react';

/**
 * Same-origin in production (SPA and `/api` on one host), so `baseURL` is left
 * undefined and the client uses `window.location.origin`.
 * Set `VITE_API_BASE_URL` only for the split-origin dev setup (`npm run dev:spa`
 * + `npm run dev:api`).
 */
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL as string | undefined) || undefined;

export const authClient = createAuthClient({
  baseURL: apiBaseUrl,
  basePath: '/api/auth',
  fetchOptions: {
    credentials: 'include',
  },
});

export const { signIn, signUp, useSession } = authClient;

/** Session user shape — Better Auth user plus our `additionalFields`. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image?: string | null;
  role?: string | null;
  tenantId?: string | null;
  branchId?: string | null;
  status?: string | null;
}

export interface SessionResponse {
  user: SessionUser;
  session: Record<string, unknown>;
}

/**
 * Typed wrappers.
 *
 * Better Auth's client types re-export the *server* endpoint signatures for
 * argument-less calls, so `getSession()` / `signOut()` alone do not type-check
 * even though they work at runtime. These two thin wrappers keep the call sites
 * clean and the return type honest.
 */
export function getSession(): Promise<{ data: SessionResponse | null }> {
  return (authClient.getSession as unknown as () => Promise<{ data: SessionResponse | null }>)();
}

export function signOut(): Promise<unknown> {
  return (authClient.signOut as unknown as () => Promise<unknown>)();
}

/** @deprecated kept for older call sites; prefer the `useAuth` hook. */
export async function isAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return Boolean(session?.data?.session);
}

/** @deprecated kept for older call sites; prefer the `useAuth` hook. */
export async function getUserRole(): Promise<string | undefined> {
  const session = await getSession();
  return session?.data?.user?.role ?? undefined;
}
