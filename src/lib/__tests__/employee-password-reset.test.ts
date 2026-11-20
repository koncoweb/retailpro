import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, type ApiRequest, type ApiResponse } from '../../../server/http';
import handler from '../../../api/admin/users/[id]/password';

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  findTarget: vi.fn(),
  setUserPassword: vi.fn(),
  generatePassword: vi.fn(),
}));

vi.mock('../../../server/auth-helpers.js', () => ({ requireAdminSession: mocks.requireAdminSession }));
vi.mock('../../../server/auth.js', () => ({ auth: { api: { setUserPassword: mocks.setUserPassword } } }));
vi.mock('../../../api/admin/users.js', () => ({ generatePassword: mocks.generatePassword }));
vi.mock('../../../server/control-db.js', () => ({
  getControlDb: () => ({
    selectFrom: () => ({ select: () => ({ where: () => ({ executeTakeFirst: mocks.findTarget }) }) }),
  }),
}));

const employee = { id: 'employee', email: 'employee@example.test', tenantId: 'tenant', role: 'cashier' };

async function reset(id: string, body: unknown = {}, method = 'POST') {
  const req = { method, query: { id }, headers: {}, body } as unknown as ApiRequest;
  const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() } as unknown as ApiResponse;
  await handler(req, res);
  const payload = JSON.parse(vi.mocked(res.end).mock.calls[0][0] as string);
  return { status: res.statusCode, payload };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.requireAdminSession.mockResolvedValue({
    user: { id: 'actor', role: 'tenant_owner' },
    tenant: { id: 'tenant', owner_user_id: 'owner' },
  });
  mocks.findTarget.mockResolvedValue(employee);
  mocks.generatePassword.mockReturnValue('temporary-test-password');
  mocks.setUserPassword.mockResolvedValue({ status: true });
});

describe('employee password reset safeguards', () => {
  it('rejects self-reset before generating or changing a password', async () => {
    mocks.findTarget.mockResolvedValue({ ...employee, id: 'actor', role: 'tenant_admin' });
    expect(await reset('actor')).toMatchObject({ status: 403, payload: { error: 'cannot_reset_yourself' } });
    expect(mocks.generatePassword).not.toHaveBeenCalled();
    expect(mocks.setUserPassword).not.toHaveBeenCalled();
  });

  it.each(['tenant_owner', 'platform_owner'])('protects a %s account from another administrator', async (role) => {
    mocks.findTarget.mockResolvedValue({ ...employee, role });
    expect(await reset(employee.id)).toMatchObject({ status: 403, payload: { error: 'cannot_reset_owner' } });
    expect(mocks.generatePassword).not.toHaveBeenCalled();
    expect(mocks.setUserPassword).not.toHaveBeenCalled();
  });

  it('protects the registered owner even if their role field is stale', async () => {
    mocks.findTarget.mockResolvedValue({ ...employee, id: 'owner' });
    expect(await reset('owner')).toMatchObject({ status: 403, payload: { error: 'cannot_reset_owner' } });
    expect(mocks.setUserPassword).not.toHaveBeenCalled();
  });

  it('does not disclose accounts belonging to another tenant', async () => {
    mocks.findTarget.mockResolvedValue({ ...employee, tenantId: 'other-tenant', role: 'tenant_owner' });
    expect(await reset(employee.id)).toMatchObject({ status: 404, payload: { error: 'user_not_found' } });
    expect(mocks.setUserPassword).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing account without changing credentials', async () => {
    mocks.findTarget.mockResolvedValue(undefined);
    expect(await reset('missing')).toMatchObject({ status: 404, payload: { error: 'user_not_found' } });
    expect(mocks.setUserPassword).not.toHaveBeenCalled();
  });

  it.each([401, 403])('retains the session guard HTTP %s response', async (status) => {
    mocks.requireAdminSession.mockRejectedValue(new HttpError(status, 'forbidden'));
    expect((await reset(employee.id)).status).toBe(status);
    expect(mocks.findTarget).not.toHaveBeenCalled();
    expect(mocks.setUserPassword).not.toHaveBeenCalled();
  });

  it('still generates a one-time password for another employee', async () => {
    expect(await reset(employee.id)).toEqual({
      status: 200, payload: { userId: employee.id, tempPassword: 'temporary-test-password' },
    });
    expect(mocks.setUserPassword).toHaveBeenCalledExactlyOnceWith({
      body: { userId: employee.id, newPassword: 'temporary-test-password' }, headers: {},
    });
  });

  it('preserves an explicitly supplied employee password', async () => {
    await reset(employee.id, { password: 'chosen-test-password' });
    expect(mocks.generatePassword).not.toHaveBeenCalled();
    expect(mocks.setUserPassword).toHaveBeenCalledExactlyOnceWith({
      body: { userId: employee.id, newPassword: 'chosen-test-password' }, headers: {},
    });
  });

  it('does not generate credentials for non-POST requests', async () => {
    expect((await reset(employee.id, {}, 'GET')).status).toBe(405);
    expect(mocks.requireAdminSession).not.toHaveBeenCalled();
    expect(mocks.setUserPassword).not.toHaveBeenCalled();
  });
});
