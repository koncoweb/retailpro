/**
 * Tenant bootstrap.
 *
 * After Better Auth resolves a session, the app still has no database to talk
 * to: the tenant's Turso URL and its token come from `/api/tenant/bootstrap`.
 * This provider performs that one call, stores the result in memory (see
 * `src/lib/tenant-session.ts`) and gates protected routes until it succeeds.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { resetClient } from '@/lib/db/client';
import {
  getTenantSession,
  setTenantSession,
  clearTenantSession,
  type TenantSession,
} from '@/lib/tenant-session';
import type { UserRole } from '@/types';

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '';

export type BootstrapStatus = 'idle' | 'loading' | 'ready' | 'no-tenant' | 'error';

export interface BootstrapFailure {
  status: number;
  code: string;
  message: string;
}

interface TenantContextValue {
  session: TenantSession | null;
  status: BootstrapStatus;
  failure: BootstrapFailure | null;
  /** Re-runs bootstrap (used right after provisioning or a failed attempt). */
  bootstrap: () => Promise<TenantSession | null>;
  clear: () => void;
}

const TenantContext = createContext<TenantContextValue | null>(null);

interface BootstrapPayload {
  dbUrl: string;
  token: string;
  expiresAt: string;
  tenant: { id: string; name: string; slug: string };
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole;
    branchId: string | null;
  };
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<BootstrapStatus>('idle');
  const [failure, setFailure] = useState<BootstrapFailure | null>(null);
  const [session, setSession] = useState<TenantSession | null>(getTenantSession());
  const inFlight = useRef<Promise<TenantSession | null> | null>(null);

  const clear = useCallback(() => {
    resetClient();
    clearTenantSession();
    setSession(null);
    setStatus('idle');
    setFailure(null);
  }, []);

  /**
   * Resolves the tenant database + token.
   *
   * Returns `null` only for "this account has no company yet"; every other
   * failure throws, so callers can tell "not provisioned" apart from "the server
   * said no".
   */
  const bootstrap = useCallback(async (): Promise<TenantSession | null> => {
    if (inFlight.current) return inFlight.current;

    const run = (async () => {
      setStatus('loading');
      setFailure(null);

      let response: Response;
      try {
        response = await fetch(`${apiBase}/api/tenant/bootstrap`, {
          method: 'GET',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Network error';
        setFailure({ status: 0, code: 'network_error', message });
        setStatus('error');
        throw new Error(message);
      }

      if (!response.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let body: any = {};
        try {
          body = await response.json();
        } catch {
          body = {};
        }

        const code = body?.error ?? 'bootstrap_failed';
        const message = body?.message ?? `Bootstrap failed (HTTP ${response.status})`;

        if (response.status === 404 && code === 'no_tenant') {
          setFailure({ status: response.status, code, message });
          setStatus('no-tenant');
          return null;
        }

        setFailure({ status: response.status, code, message });
        setStatus('error');
        throw new Error(message);
      }

      const payload = (await response.json()) as BootstrapPayload;
      const next: TenantSession = {
        dbUrl: payload.dbUrl,
        token: payload.token,
        expiresAt: payload.expiresAt,
        tenantId: payload.tenant.id,
        tenantName: payload.tenant.name,
        tenantSlug: payload.tenant.slug,
        userId: payload.user.id,
        userName: payload.user.name,
        userEmail: payload.user.email,
        role: payload.user.role,
        branchId: payload.user.branchId,
      };

      setTenantSession(next);
      setSession(next);
      setStatus('ready');
      return next;
    })();

    inFlight.current = run;
    try {
      return await run;
    } finally {
      inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;

    if (!isAuthenticated) {
      if (getTenantSession()) clear();
      setStatus('idle');
      return;
    }

    // Only `idle` starts a fetch. Every other state is either in flight or a
    // terminal answer the user must act on ("Coba lagi", provisioning), and
    // re-entering the effect on our own status updates is what previously turned
    // a single `no_tenant` answer into an endless /api/tenant/bootstrap loop.
    if (status !== 'idle') return;

    void bootstrap().catch(() => undefined);
  }, [authLoading, isAuthenticated, status, bootstrap, clear]);

  const value = useMemo<TenantContextValue>(
    () => ({ session, status, failure, bootstrap, clear }),
    [session, status, failure, bootstrap, clear]
  );

  // A brand new sign-in must not reuse another tenant's cached query data.
  useEffect(() => {
    if (status === 'idle' && session === null) {
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth-session' });
    }
  }, [status, session, queryClient]);

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const context = useContext(TenantContext);
  if (!context) {
    throw new Error('useTenant must be used inside <TenantProvider>');
  }
  return context;
}

/**
 * Blocks rendering until the tenant database is reachable.
 *
 * Used for every protected route so a page can never mount with no client and
 * fire queries that fail with "Tenant database is not ready".
 */
export function RequireTenant({ children }: { children: ReactNode }) {
  const { status, failure, bootstrap } = useTenant();

  if (status === 'ready') return <>{children}</>;

  if (status === 'no-tenant') {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-2xl font-semibold">Belum ada perusahaan</h1>
        <p className="max-w-md text-muted-foreground">
          Akun ini belum terhubung ke database perusahaan mana pun.
        </p>
        <a className="text-sm font-medium text-primary underline" href="/register-tenant">
          Daftarkan perusahaan
        </a>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-xl font-semibold">Gagal memuat database</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {failure?.message ?? 'Terjadi kesalahan saat menghubungi server.'}
        </p>
        <button
          type="button"
          className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          onClick={() => void bootstrap()}
        >
          Coba lagi
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}
