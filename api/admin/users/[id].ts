/**
 * PATCH  /api/admin/users/[id]  { name?, role?, branchId?, active? }
 * DELETE /api/admin/users/[id]
 *
 * The one writer of an employee's identity.
 *
 * Before this endpoint the Employees screen updated the tenant database's
 * `users` projection and nothing else, while the session — and therefore every
 * route guard — reads the control-plane role. Editing a role saved, toasted
 * "tersimpan", and changed nothing; deleting an employee left the identity
 * signed-in-able and `/api/tenant/bootstrap` kept handing it a full-access token
 * for the company database.
 *
 * Both writes happen here, control plane first, projection second, so the two
 * can no longer disagree. The rules that used to live inside a page's SQL
 * (`role NOT IN ('platform_owner', …)`, "not your own account") moved with them
 * so they apply to every caller, not just the screen that remembered them.
 */
import { requireAdminSession } from '../../../server/auth-helpers.js';
import { getControlDb } from '../../../server/control-db.js';
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
  withErrors,
  type ApiRequest,
  type ApiResponse,
} from '../../../server/http.js';
import {
  assertAssignableRole,
  deleteUserProjection,
  writeUserProjection,
} from '../../../server/roles.js';

interface PatchUserBody {
  name?: string;
  role?: string;
  branchId?: string | null;
  active?: boolean;
}

/** Roles that own a company: never reassigned or removed from this screen. */
const OWNER_ROLES = new Set(['tenant_owner', 'platform_owner']);

function readUserId(req: ApiRequest): string {
  const fromQuery = req.query?.id;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;

  // `vercel dev` and the local dev server both populate `req.query`; fall back
  // to parsing the path (/api/admin/users/<id>) when they do not. The trailing
  // slash matters so this never steals the `/password` route.
  const match = /\/admin\/users\/([^/?#]+?)(?:\/|$)/.exec(req.url ?? '');
  if (match && match[1] !== 'password') return decodeURIComponent(match[1]);
  throw new HttpError(400, 'missing_user_id', 'User id is required.');
}

interface TargetRow {
  id: string;
  email: string;
  name: string;
  role: string | null;
  tenantId: string | null;
  branchId: string | null;
  status: string | null;
}

async function loadTarget(userId: string, tenantId: string): Promise<TargetRow> {
  const control = getControlDb();
  const target = await control
    .selectFrom('user')
    .select(['id', 'email', 'name', 'role', 'tenantId', 'branchId', 'status'])
    .where('id', '=', userId)
    .executeTakeFirst();

  if (!target || target.tenantId !== tenantId) {
    throw new HttpError(404, 'user_not_found', 'No such user in this company.');
  }
  return target as TargetRow;
}

async function handlePatch(req: ApiRequest, res: ApiResponse) {
  const { user: actor, tenant } = await requireAdminSession(req.headers);
  const userId = readUserId(req);
  const target = await loadTarget(userId, tenant.id);
  const body = await readJsonBody<PatchUserBody>(req);

  const role = typeof body.role === 'string' ? body.role.trim() : undefined;
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  const changingBranch = 'branchId' in body;
  const branchId = changingBranch ? (body.branchId?.trim() || null) : null;
  const active = typeof body.active === 'boolean' ? body.active : undefined;

  if (name !== undefined && name.length < 2) {
    throw new HttpError(400, 'invalid_name', 'Nama karyawan terlalu pendek.');
  }

  // An owner is the person provisioning paid for. Losing that account takes the
  // company with it, so neither the demotion nor the branch-linking shortcut
  // that used to live in Branches.tsx may touch it.
  if (target.role && OWNER_ROLES.has(target.role)) {
    if (role || changingBranch || active !== undefined) {
      throw new HttpError(
        400,
        'cannot_reassign_owner',
        'Akun owner tidak bisa diubah role, cabang, atau statusnya dari layar ini.'
      );
    }
  }

  // Better Auth refuses to strip a session's own owner; the same rule keeps an
  // admin from locking themselves out of the company they just configured.
  if (userId === actor.id && (role !== undefined || active !== undefined || changingBranch)) {
    throw new HttpError(
      400,
      'cannot_remove_yourself',
      'Anda tidak bisa mengubah role atau status akun Anda sendiri.'
    );
  }

  if (role && role !== target.role) {
    await assertAssignableRole(role, tenant);
  }

  const nextRole = role ?? target.role ?? 'staff';
  const nextName = name ?? target.name;
  const nextBranchId = changingBranch ? branchId : target.branchId ?? null;
  const nextActive = active ?? target.status !== 'inactive';

  const control = getControlDb();
  await control
    .updateTable('user')
    .set({
      name: nextName,
      role: nextRole,
      branchId: nextBranchId,
      // `banned` is what Better Auth itself checks at sign-in; `status` is what
      // this app's bootstrap checks. Setting only one of them is how a
      // "nonaktif" employee could keep logging straight in.
      status: nextActive ? 'active' : 'inactive',
      banned: nextActive ? 0 : 1,
      updatedAt: new Date().toISOString(),
    })
    .where('id', '=', userId)
    .execute();

  await writeUserProjection(tenant, {
    id: userId,
    email: target.email,
    name: nextName,
    role: nextRole,
    branchId: nextBranchId,
    isActive: nextActive,
  });

  sendJson(res, 200, {
    userId,
    role: nextRole,
    branchId: nextBranchId,
    active: nextActive,
  });
}

async function handleDelete(req: ApiRequest, res: ApiResponse) {
  const { user: actor, tenant } = await requireAdminSession(req.headers);
  const userId = readUserId(req);
  const target = await loadTarget(userId, tenant.id);

  if (userId === actor.id) {
    throw new HttpError(
      400,
      'cannot_remove_yourself',
      'Anda tidak bisa menghapus akun Anda sendiri.'
    );
  }
  if (target.role && OWNER_ROLES.has(target.role)) {
    throw new HttpError(
      400,
      'cannot_reassign_owner',
      'Akun owner tidak bisa dihapus dari layar ini.'
    );
  }

  const control = getControlDb();

  // Sessions survive a deleted user, and a live session still earns a tenant
  // token — which is the whole reason this endpoint exists rather than a plain
  // `DELETE FROM users`. `session` then `account` then `user`, because the
  // credential row is what actually blocks re-creating the same email.
  await control.deleteFrom('session').where('userId', '=', userId).execute();
  await control.deleteFrom('account').where('userId', '=', userId).execute();
  await control.deleteFrom('user').where('id', '=', userId).execute();

  await deleteUserProjection(tenant, userId);

  sendJson(res, 200, { userId, deleted: true });
}

async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method === 'PATCH' || req.method === 'POST') return handlePatch(req, res);
  if (req.method === 'DELETE') return handleDelete(req, res);
  return methodNotAllowed(res, ['PATCH', 'DELETE']);
}

export default withErrors(handler);
