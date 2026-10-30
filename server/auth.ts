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
  trustedOrigins: [
    ...(optionalEnv('BETTER_AUTH_URL') ? [optionalEnv('BETTER_AUTH_URL') as string] : []),
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:8080',
    ...(optionalEnv('VITE_API_BASE_URL') ? [optionalEnv('VITE_API_BASE_URL') as string] : []),
  ],
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
