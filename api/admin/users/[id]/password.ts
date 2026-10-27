/**
 * POST /api/admin/users/[id]/password  { password? }
 *
 * Resets a colleague's password inside the caller's own tenant. The password is
 * generated server-side and returned once (never defaulted to a shared constant).
 *
 * Replaces the old `/admin/update-user` call in BranchDetailModal.tsx.
 */
import { auth } from '../../../../server/auth';
import { requireAdminSession } from '../../../../server/auth-helpers';
import { getControlDb } from '../../../../server/control-db';
import {
  HttpError,
  methodNotAllowed,
  readJsonBody,
  sendJson,
  withErrors,
  type ApiRequest,
  type ApiResponse,
} from '../../../../server/http';
import { generatePassword } from '../../users';

interface PasswordBody {
  password?: string;
}

function readUserId(req: ApiRequest): string {
  const fromQuery = req.query?.id;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;

  // `vercel dev` and the local dev server both populate `req.query`; fall back to
  // parsing the path (/api/admin/users/<id>/password) when they do not.
  const match = /\/admin\/users\/([^/]+)\/password/.exec(req.url ?? '');
  if (match) return decodeURIComponent(match[1]);
  throw new HttpError(400, 'missing_user_id', 'User id is required.');
}

async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { tenant } = await requireAdminSession(req.headers);
  const userId = readUserId(req);

  const control = getControlDb();
  const target = await control
    .selectFrom('user')
    .select(['id', 'tenantId', 'email'])
    .where('id', '=', userId)
    .executeTakeFirst();

  if (!target || target.tenantId !== tenant.id) {
    throw new HttpError(404, 'user_not_found', 'No such user in this company.');
  }

  const body = await readJsonBody<PasswordBody>(req);
  const password = body.password?.trim() || generatePassword();

  try {
    await auth.api.setUserPassword({
      body: { userId, newPassword: password },
      headers: req.headers as unknown as Headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new HttpError(400, 'password_reset_failed', message);
  }

  sendJson(res, 200, { userId, tempPassword: password });
}

export default withErrors(handler);
