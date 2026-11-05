/**
 * POST /api/admin/users
 *   { email, name, role, branchId?, password? }
 *
 * Creates an employee identity on the control plane and links it to the caller's
 * tenant. The caller (owner/admin) receives the generated temporary password
 * exactly once — it is never stored or logged in plaintext.
 *
 * The role may be a builtin or one of the tenant's custom (`cust_*`) roles. The
 * Better Auth plugin only understands the builtin vocabulary, so the account is
 * created with the custom role's `auth_tier` and the real key is written by the
 * authoritative `UPDATE` below. The admin plugin would otherwise refuse an owner
 * invented on the Settings screen, which is exactly the four-place edit this
 * project set out to remove.
 *
 * The tenant-database `users` projection row is written by the caller
 * (`Employees.tsx`), because that write also carries the salary.
 */
import { randomBytes } from 'node:crypto';
import { MIN_PASSWORD_LENGTH } from '../../src/lib/password.js';
import { auth } from '../../server/auth.js';
import type { AppRole } from '../../server/access.js';
import { requireAdminSession } from '../../server/auth-helpers.js';
import { getControlDb } from '../../server/control-db.js';
import { authTierFor, assignableRolesForTenant } from '../../server/roles.js';
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
  withErrors,
  type ApiRequest,
  type ApiResponse,
} from '../../server/http.js';

interface CreateUserBody {
  email?: string;
  name?: string;
  role?: string;
  branchId?: string;
  password?: string;
}

export function generatePassword(): string {
  // 12 random bytes -> 16 URL-safe characters, comfortably above the 8 char floor.
  return randomBytes(12).toString('base64url');
}

async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { tenant } = await requireAdminSession(req.headers);
  const body = await readJsonBody<CreateUserBody>(req);

  const email = (body.email ?? '').trim().toLowerCase();
  const name = (body.name ?? '').trim();
  const role = (body.role ?? 'staff').trim();
  const branchId = body.branchId?.trim() || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpError(400, 'invalid_email', 'A valid email address is required.');
  }
  if (name.length < 2) {
    throw new HttpError(400, 'invalid_name', 'Name is too short.');
  }
  const assignable = await assignableRolesForTenant(tenant);
  // The shipped builtins plus this tenant's custom roles. `tenant_owner` and
  // `platform_owner` are never in the set: an owner exists because provisioning
  // created them.
  if (!assignable.has(role)) {
    throw new HttpError(
      400,
      'invalid_role',
      `Role "${role}" cannot be assigned in this company.`
    );
  }

  // The Employees dialog checks this first and says so beside the field. This
  // is the backstop for every other caller: without it an admin (or a script)
  // could set a one-character password, because the endpoint used to generate
  // the password itself and never had to judge one.
  const typedPassword = body.password?.trim() ?? '';
  if (typedPassword.length > 0 && typedPassword.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(
      400,
      'weak_password',
      `A password needs at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }

  const control = getControlDb();
  const existing = await control
    .selectFrom('user')
    .select(['id', 'tenantId'])
    .where('email', '=', email)
    .executeTakeFirst();
  if (existing) {
    throw new HttpError(
      409,
      'email_taken',
      'A user with this email already exists (maybe in another company).'
    );
  }

  const password = typedPassword || generatePassword();
  const authTier = authTierFor(assignable, role);

  let created: { user?: { id?: string } } | undefined;
  try {
    created = (await auth.api.createUser({
      body: {
        email,
        password,
        name,
        // The plugin's `role` is typed as the union declared in `server/access.ts`
        // and `authTier` comes out of `BUILTIN_ASSIGNABLE_ROLES`, so the cast is
        // only widening `string` back to it.
        role: authTier as AppRole,
        data: {
          tenantId: tenant.id,
          branchId: branchId ?? undefined,
          status: 'active',
        },
      },
      headers: req.headers as unknown as Headers,
    })) as { user?: { id?: string } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, 'create_user_failed', message);
  }

  const userId = created?.user?.id;
  if (!userId) {
    throw new HttpError(502, 'create_user_failed', 'Better Auth did not return a user id.');
  }

  // `additionalFields` declared with `input: false` are not always persisted from
  // `data`, so the authoritative write happens here — and this is also where a
  // custom role key replaces the `auth_tier` the plugin was given.
  await control
    .updateTable('user')
    .set({
      tenantId: tenant.id,
      branchId: branchId ?? null,
      role,
      status: 'active',
      updatedAt: new Date().toISOString(),
    })
    .where('id', '=', userId)
    .execute();

  sendJson(res, 201, {
    userId,
    email,
    name,
    role,
    branchId,
    tenantId: tenant.id,
    // Shown once in a copy dialog; never retrievable again.
    tempPassword: password,
  });
}

export default withErrors(handler);
