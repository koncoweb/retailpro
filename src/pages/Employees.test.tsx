// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { query } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { toast } from 'sonner';
import Employees from './Employees';

vi.mock('@/components/layout/BackOfficeLayout', () => ({ BackOfficeLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/employees/IndividualPermissionEditor', () => ({ IndividualPermissionEditor: () => null }));
vi.mock('@/lib/db', () => ({ query: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/tenant-settings', () => ({ clearUserPermissionOverrides: vi.fn(), setUserPermissionOverrides: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: () => true, grants: {}, loading: false }),
  useBranchScope: () => ({ branchIds: null }),
  useTenantUserPermissionsQuery: () => ({ data: {} }),
  useInvalidateTenantUserPermissions: () => vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const fetchMock = vi.fn();
const rows = [
  { id: 'actor', name: 'Self', role: 'tenant_admin' },
  { id: 'owner', name: 'Owner', role: 'tenant_owner' },
  { id: 'staff', name: 'Staff', role: 'cashier' },
].map((user) => ({
  ...user, email: `${user.id}@example.test`, assigned_branch_id: null, branch_name: null,
  is_active: true, created_at: '2026-11-19T00:00:00Z', base_salary: 0,
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(query).mockImplementation(async (sql) => ({ rows: sql.includes('FROM users') ? rows : [], rowCount: 0 }));
  vi.mocked(logAudit).mockResolvedValue();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function mount() {
  render(<Employees />);
  // Both responsive layouts exist in jsdom; exercise the table's shared actions.
  const table = await screen.findByRole('table');
  return within(table).findByRole('button', { name: 'Reset password Staff' });
}

async function openConfirmation() {
  fireEvent.click(await mount());
  return screen.findByRole('alertdialog');
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('employee password reset confirmation', () => {
  it('never offers an employee reset for the caller or an owner', async () => {
    await mount();
    expect(screen.queryByRole('button', { name: 'Reset password Self' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset password Owner' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names the affected account and does not reset when canceled', async () => {
    const dialog = await openConfirmation();
    expect(within(dialog).getByText(/staff@example.test/)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('sends one reset for repeated clicks and shows the credential before audit completion', async () => {
    const response = deferred<{ ok: boolean; json: () => Promise<{ tempPassword: string }> }>();
    const audit = deferred<void>();
    fetchMock.mockReturnValue(response.promise);
    vi.mocked(logAudit).mockReturnValue(audit.promise);
    const dialog = await openConfirmation();
    const confirm = within(dialog).getByRole('button', { name: 'Confirm password reset' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]).toMatchObject([
      '/api/admin/users/staff/password', { method: 'POST', body: '{}' },
    ]);
    expect((within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { response.resolve({ ok: true, json: async () => ({ tempPassword: 'test-only-secret' }) }); });
    expect(await screen.findByRole('dialog', { name: 'Password Sementara' })).toBeTruthy();
    expect(screen.getByText('test-only-secret')).toBeTruthy();
    expect(logAudit).toHaveBeenCalledExactlyOnceWith({
      action: 'reset_employee_password', entity: 'users', entityId: 'staff', userId: 'actor',
      details: { email: 'staff@example.test' },
    });
    await act(async () => { audit.resolve(); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps confirmation open on an API refusal and never displays a made-up password', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ message: 'Reset refused' }) });
    const dialog = await openConfirmation();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm password reset' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Reset refused'));
    expect(screen.queryByRole('dialog', { name: 'Password Sementara' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Confirm password reset' }) as HTMLButtonElement).disabled).toBe(false);
    expect(logAudit).not.toHaveBeenCalled();
  });
});
