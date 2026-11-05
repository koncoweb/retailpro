/**
 * The server's idea of who may be assigned what.
 *
 * The Employees screen used to validate the role vocabulary in its own head and
 * then write the tenant's `users` projection, while the identity that actually
 * decides permissions lives on the control plane. Result: a role change that
 * saved happily and changed nothing. Validation therefore belongs here, in one
 * place, and both admin endpoints ask it the same question.
 *
 * The assignable set is the shipped builtin roles *plus* any custom role this
 * tenant invented, so a new owner-defined role needs no deploy.
 */
import type { TenantDatabaseRow } from './control-db.js';
import { HttpError } from './http.js';
import { withTenantClient } from './tenant-client.js';
import { BUILTIN_ASSIGNABLE_ROLES } from '../src/config/roles.js';
import type {
  CustomRoleDefinition,
  RoleGrant,
  RoleSettings,
} from '../src/lib/permission-matrix.js';
import { buildGrants, CUSTOM_ROLE_PREFIX } from '../src/lib/permission-matrix.js';

/** Owners are made by provisioning, never by this screen. */
const OWNER_ROLES = new Set(['tenant_owner', 'platform_owner']);

type TenantRef = Pick<TenantDatabaseRow, 'db_name' | 'db_hostname'>;

function settingValue(raw: unknown): RoleSettings {
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as RoleSettings) : {};
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === 'object') return raw as RoleSettings;
  return {};
}

/**
 * Reads the tenant's settings document from the server side.
 *
 * The browser has its own cached read of the same document (`src/lib/
 * tenant-settings.ts`); this is the copy the *control plane* needs before it is
 * willing to hand out a token or accept a role write.
 */
export async function readRoleSettings(tenant: TenantRef): Promise<RoleSettings> {
  return withTenantClient(tenant, async (client) => {
    const res = await client.execute(`SELECT settings FROM tenants LIMIT 1`);
    return settingValue((res.rows[0] as Record<string, unknown> | undefined)?.settings);
  });
}

export interface AssignableRoles {
  /** Every role key a caller may hand out, builtin and custom. */
  keys: string[];
  /** The custom half, so a response can name the role the way its owner did. */
  custom: Record<string, CustomRoleDefinition>;
  has: (role: string) => boolean;
}

/**
 * Builtins an admin may hand out, plus this tenant's custom roles.
 *
 * `tenant_owner` / `platform_owner` are excluded on purpose: an owner exists
 * because provisioning created them, and letting the Employees screen mint one
 * would put a second owner beside the person who owns the database.
 */
export function resolveAssignableRoles(settings: RoleSettings): AssignableRoles {
  const custom = settings.custom_roles ?? {};
  const customKeys = Object.keys(custom);
  const keys = [...BUILTIN_ASSIGNABLE_ROLES, ...customKeys];
  return {
    keys,
    custom,
    has: (role: string) => !OWNER_ROLES.has(role) && keys.includes(role),
  };
}

export async function assignableRolesForTenant(tenant: TenantRef): Promise<AssignableRoles> {
  const settings = await readRoleSettings(tenant);
  return resolveAssignableRoles(settings);
}

/** Indonesian-first message: the admin reading it is not an English speaker. */
export async function assertAssignableRole(
  role: string,
  tenant: TenantRef
): Promise<void> {
  if (OWNER_ROLES.has(role)) {
    throw new HttpError(
      400,
      'cannot_assign_owner',
      'Role owner dibuat saat perusahaan didaftarkan, tidak bisa diberikan dari layar karyawan.'
    );
  }
  const assignable = await assignableRolesForTenant(tenant);
  if (!assignable.has(role)) {
    throw new HttpError(
      400,
      'invalid_role',
      `Role "${role}" tidak dikenal di perusahaan ini. Buat dulu di Pengaturan > Role, atau pilih role yang tersedia.`
    );
  }
}

/**
 * The builtin role Better Auth is handed when creating an account.
 *
 * The admin plugin validates `role` against the static vocabulary in
 * `server/access.ts`, so a `cust_*` key cannot go through `createUser` at all.
 * The custom key is therefore written immediately afterwards by the direct
 * `UPDATE` the endpoint already performs, and this tier is only the plugin's
 * admission ticket: it decides nothing the tenant matrix does not decide.
 */
export function authTierFor(assignable: AssignableRoles, role: string): string {
  const declared = assignable.custom[role]?.auth_tier;
  if (declared && BUILTIN_ASSIGNABLE_ROLES.includes(declared as (typeof BUILTIN_ASSIGNABLE_ROLES)[number])) {
    return declared;
  }
  return assignable.has(role) && !role.startsWith(CUSTOM_ROLE_PREFIX) ? role : 'staff';
}

/**
 * The projection row mirrored into the tenant database.
 *
 * The tenant `users` row is what every business query joins against (payroll,
 * shift, POS cashier id), so it must say the same thing as the control-plane
 * identity. Both write paths land here so the two can no longer drift.
 */
export interface ProjectionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  branchId: string | null;
  isActive: boolean;
}

export async function writeUserProjection(
  tenant: TenantRef,
  user: ProjectionUser
): Promise<void> {
  await withTenantClient(tenant, async (client) => {
    await client.execute({
      sql: `INSERT INTO users (id, email, name, role, assigned_branch_id, is_active)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (id) DO UPDATE SET
              email = excluded.email,
              name = excluded.name,
              role = excluded.role,
              assigned_branch_id = excluded.assigned_branch_id,
              is_active = excluded.is_active`,
      args: [
        user.id,
        user.email,
        user.name,
        user.role,
        user.branchId,
        user.isActive ? 1 : 0,
      ],
    });
  });
}

export async function deleteUserProjection(
  tenant: TenantRef,
  userId: string
): Promise<void> {
  await withTenantClient(tenant, async (client) => {
    await client.execute({ sql: `DELETE FROM users WHERE id = ?`, args: [userId] });
  });
}

/**
 * Read one projection row, or `null` when the account has no business record.
 *
 * `/api/tenant/bootstrap` asks this before it will mint a token: a deleted or
 * deactivated person must not keep reaching the company database.
 */
export interface ProjectionState {
  role: string;
  branchId: string | null;
  isActive: boolean;
}

export async function readUserProjection(
  tenant: TenantRef,
  userId: string
): Promise<ProjectionState | null> {
  return withTenantClient(tenant, async (client) => {
    const res = await client.execute({
      sql: `SELECT role, assigned_branch_id, is_active FROM users WHERE id = ? LIMIT 1`,
      args: [userId],
    });
    const row = res.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      role: String(row.role ?? 'staff'),
      branchId: row.assigned_branch_id == null ? null : String(row.assigned_branch_id),
      isActive: Number(row.is_active ?? 0) !== 0,
    };
  });
}

/** The custom roles of a tenant, resolved exactly the way the SPA resolves them. */
export async function readTenantGrants(tenant: TenantRef): Promise<Record<string, RoleGrant>> {
  const settings = await readRoleSettings(tenant);
  return buildGrants(settings);
}
