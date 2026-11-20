/**
 * Better Auth on the control-plane database.
 *
 * The `role` field doubles as the admin-plugin role, so the plugin is configured
 * with RetailPro's own vocabulary (`src/config/roles.ts`) instead of Better
 * Auth's default `admin`.
 */
import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { getControlDb } from './control-db.js';
import { optionalEnv, requiredEnv } from './env.js';
import { roles, type AppRole } from './access.js';

/** Roles allowed to call `auth.api.createUser` / `setUserPassword`. */
export const ADMIN_ROLES: AppRole[] = ['platform_owner', 'tenant_owner', 'tenant_admin'];

/**
 * Origins Better Auth accepts on credentialed POSTs. Anything missing here comes
 * back as FORBIDDEN "Invalid origin" on sign-in, so the list must cover every host
 * the SPA is actually opened on.
 *
 * `BETTER_AUTH_URL` is the canonical origin, but Vercel answers a custom domain on
 * both the apex and `www` and redirects apex -> www, and a browser may have started
 * on either. Rather than paste two hostnames into one env var, both spellings of the
 * canonical host are trusted: `www.` is stripped, and a bare host also gets its `www.`
 * sibling. Loopback aliases (`127.0.0.1`, `[::1]`) follow the same rule so a dev run
 * reached by IP is not rejected.
 */
function originSiblings(raw: string): string[] {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [raw];
  }
  const host = url.hostname.toLowerCase();
  const bare = host.startsWith('www.') ? host.slice(4) : host;
  const hosts = new Set([host, bare, bare ? `www.${bare}` : host]);
  if (bare === 'localhost' || bare === '127.0.0.1') {
    hosts.add(bare === '127.0.0.1' ? 'localhost' : '127.0.0.1');
    hosts.add('[::1]');
  }
  const port = url.port ? `:${url.port}` : '';
  return [...hosts].map((h) => `${url.protocol}//${h}${port}`);
}

function trustedOrigins(): string[] {
  const configured = [
    optionalEnv('BETTER_AUTH_URL'),
    // The native Vercel host stays a first-class origin so an older bookmark (or a
    // bare `*.vercel.app` URL handed out before the custom domain) can still sign
    // in. It is our own deployment, pinned by project name — not a wildcard.
    'https://retailpro-thalia.vercel.app',
    optionalEnv('VITE_API_BASE_URL'),
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    'http://localhost:8082',
  ].filter((o): o is string => Boolean(o));
  return [...new Set(configured.flatMap(originSiblings))];
}

export const auth = betterAuth({
  appName: 'RetailPro',
  secret: requiredEnv('BETTER_AUTH_SECRET'),
  baseURL: optionalEnv('BETTER_AUTH_URL'),
  database: {
    db: getControlDb(),
    type: 'sqlite',
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  user: {
    additionalFields: {
      // The tenant this identity belongs to. Equals `tenant_databases.id` and the
      // `tenants.id` row inside that tenant's own database.
      tenantId: { type: 'string', required: false, input: false },
      // Only set when a person is tied to a single branch (cashier, manager).
      branchId: { type: 'string', required: false, input: false },
      status: { type: 'string', required: false, input: false, defaultValue: 'active' },
      // `role` is contributed by the admin plugin below (it owns that field), so
      // it must not be redeclared here.
    },
  },
  plugins: [
    admin({
      // RetailPro's vocabulary, not the plugin's default `user` / `admin`.
      roles,
      adminRoles: ADMIN_ROLES,
      defaultRole: 'staff',
      impersonationSessionDuration: 60 * 60,
    }),
  ],
  trustedOrigins: trustedOrigins(),
  advanced: {
    // Same-origin deployment (SPA + /api on one host) uses Lax cookies.
    useSecureCookies: (optionalEnv('BETTER_AUTH_URL') ?? '').startsWith('https://'),
  },
});

export type Auth = typeof auth;

/** Session shape after our `additionalFields` are merged in. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  tenantId?: string | null;
  branchId?: string | null;
  status?: string | null;
}
