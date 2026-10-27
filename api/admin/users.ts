/**
 * POST /api/admin/users
 *   { email, name, role, branchId?, baseSalary?, password? }
 *
 * Creates an employee identity on the control plane and links it to the caller's
 * tenant. The caller (owner/admin) receives the generated temporary password
 * exactly once — it is never stored or logged in plaintext.
 *
 * The tenant-database `users` projection row is written by the caller
 * (`Employees.tsx`), because that write needs the tenant token the browser
 * already holds.
 */
import { randomBytes } from 'node:crypto';
import { auth } from '../../server/auth';
import type { AppRole } from '../../server/access';
import { requireAdminSession } from '../../server/auth-helpers';
import { getControlDb } from '../../server/control-db';
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
  withErrors,
  type ApiRequest,
  type ApiResponse,
} from '../../server/http';

interface CreateUserBody {
  email?: string;
  name?: string;
  role?: string;
  branchId?: string;
  password?: string;
}

/** Roles a tenant admin may hand out. `tenant_owner` and `platform_owner` are excluded. */
const ASSIGNABLE_ROLES = new Set([
  'tenant_admin',
  'store_manager',
  'cashier',
  'warehouse',
  'staff',
]);

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
  if (!ASSIGNABLE_ROLES.has(role)) {
    throw new HttpError(400, 'invalid_role', `Role "${role}" cannot be assigned.`);
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

  const password = body.password?.trim() || generatePassword();

  let created: { user?: { id?: string } } | undefined;
  try {
    created = (await auth.api.createUser({
      body: {
        email,
        password,
        name,
        // The admin plugin's `role` is typed as the union declared in
        // `server/access.ts`, and `ASSIGNABLE_ROLES` above is checked against the
        // same vocabulary, so the cast is only widening `string` back to it.
        role: role as AppRole,
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
  // `data`, so the authoritative write happens here.
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
