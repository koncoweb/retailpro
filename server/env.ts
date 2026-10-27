/**
 * Server-side environment access.
 *
 * Nothing in `server/` or `api/` may be imported from `src/`: these values are
 * secrets and must never reach the browser bundle. Only `VITE_*` variables are
 * public.
 */

export class MissingEnvError extends Error {
  constructor(name: string) {
    super(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env.local and fill it in (see Phase 0 of the migration plan).`
    );
    this.name = 'MissingEnvError';
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') throw new MissingEnvError(name);
  return value.trim();
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

export function numberEnv(name: string, fallback: number): number {
  const raw = optionalEnv(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Turso organization slug, e.g. `koncowebliberation`. */
export const tursoOrg = () => requiredEnv('TURSO_ORG_SLUG');

/** Turso organization (platform) API token. Server only. */
export const tursoApiToken = () => requiredEnv('TURSO_API_TOKEN');

/** Turso group that every tenant database belongs to. */
export const tursoGroup = () => optionalEnv('TURSO_GROUP') ?? 'retailpro';

export const maxTenantDatabases = () => numberEnv('TURSO_MAX_TENANT_DATABASES', 99);

/** Lifecycle of a token handed to the browser. Kept short on purpose. */
export const BROWSER_TOKEN_TTL = optionalEnv('TENANT_TOKEN_TTL') ?? '60m';
