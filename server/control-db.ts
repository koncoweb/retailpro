/**
 * Control-plane database: Better Auth identity + the tenant -> database registry.
 *
 * One Kysely instance backed by libSQL, reused across invocations of a warm
 * serverless function. Better Auth receives the very same instance
 * (`database: { db, type: 'sqlite' }`), so both share one connection pool and we
 * never pay for two clients.
 */
import { ColumnType, Kysely } from 'kysely';
import { LibsqlDialect } from '@libsql/kysely-libsql';
import { optionalEnv, requiredEnv } from './env.js';

/** Shape of the registry row. Business data never lives here. */
export interface TenantDatabaseRow {
  id: string;
  owner_user_id: string;
  slug: string;
  company_name: string;
  db_name: string;
  db_hostname: string;
  group_name: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * A GOWA webhook receipt logged by `POST /api/storefront/webhook`.
 *
 * `id` and `received_at` carry SQL DEFAULTs in `db/schema/control.sql`, and
 * `ColumnType<..., insert: undefined>` is what tells Kysely they may be omitted on
 * insert — a plain `?:` is not enough (its insert type still demands the key).
 */
export interface WhatsappEventRow {
  id: ColumnType<string, string | undefined, never>;
  event: string;
  device_id: string | null;
  message_id: string | null;
  chat_jid: string | null;
  sender_jid: string | null;
  ack: string | null;
  body: string | null;
  outcome: string;
  payload: string;
  received_at: ColumnType<string, string | undefined, never>;
}

export interface ControlDatabase {
  user: Record<string, unknown> & {
    id: string;
    email: string;
    name: string;
    role?: string | null;
    tenantId?: string | null;
    branchId?: string | null;
    status?: string | null;
  };
  session: Record<string, unknown>;
  account: Record<string, unknown>;
  verification: Record<string, unknown>;
  tenant_databases: TenantDatabaseRow;
  whatsapp_events: WhatsappEventRow;
}

export type ControlKysely = Kysely<ControlDatabase>;

let cached: ControlKysely | null = null;

/**
 * `sqlite` is the dialect `type` Better Auth expects for libSQL: dates are
 * stored as ISO strings and booleans as 0/1 (matches db/schema/control.sql).
 *
 * `@libsql/client` also accepts `file:` URLs in Node, so the same code path
 * serves production and the local/test scratch database.
 */
export function getControlDb(): ControlKysely {
  if (cached) return cached;

  const url = requiredEnv('CONTROL_DB_URL');
  const authToken = optionalEnv('CONTROL_DB_TOKEN');

  cached = new Kysely<ControlDatabase>({
    dialect: new LibsqlDialect({ url, authToken }),
  });
  return cached;
}
