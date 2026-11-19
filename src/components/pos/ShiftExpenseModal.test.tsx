// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { readShiftCashReport, recordShiftExpense, type ShiftCashReport } from '@/lib/shift-cash';
import { ShiftExpenseModal } from './ShiftExpenseModal';
import { ShiftModal } from './ShiftModal';

const permissions = vi.hoisted(() => ({ allowed: true }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'cashier' } }) }));
vi.mock('@/hooks/use-permissions', () => ({ usePermissions: () => ({ can: () => permissions.allowed }) }));
vi.mock('@/lib/shift-cash', async (original) => ({
  ...await original<typeof import('@/lib/shift-cash')>(),
  readShiftCashReport: vi.fn(), recordShiftExpense: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const report: ShiftCashReport = {
  startTime: '2026-11-19T02:00:00Z', initialCash: 100000, cashSales: 50000,
  totalSales: 80000, txCount: 2, feeTotal: 0, voidCount: 0, voidAmount: 0,
  expenseTotal: 10000, expectedCash: 140000,
  expenses: [{ id: 'donation', amount: 10000, description: 'Community donation', created_at: '2026-11-19T04:00:00Z' }],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function mount(open = true) {
  const onOpenChange = vi.fn();
  const props = { open, onOpenChange, shiftId: 'shift', branchId: 'branch' };
  return { ...render(<ShiftExpenseModal {...props} />), props, onOpenChange };
}
async function enterExpense() {
  await screen.findByText(/Saldo kas laci/);
  fireEvent.change(screen.getByLabelText('Nominal (Rp)'), { target: { value: '10000' } });
  fireEvent.change(screen.getByLabelText('Keterangan'), { target: { value: 'Community donation' } });
}
beforeEach(() => {
  vi.resetAllMocks();
  permissions.allowed = true;
  vi.mocked(readShiftCashReport).mockResolvedValue(report);
  vi.mocked(recordShiftExpense).mockResolvedValue();
});
afterEach(cleanup);

describe('POS cash expense dialog', () => {
  it('requires both fields and saves the cashier, branch, and shift before refreshing totals', async () => {
    mount();
    await screen.findByText(/Saldo kas laci/);
    const save = screen.getByRole('button', { name: 'Simpan Pengeluaran' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Nominal (Rp)'), { target: { value: '10000' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Keterangan'), { target: { value: 'Community donation' } });
    fireEvent.click(save);
    await waitFor(() => expect(recordShiftExpense).toHaveBeenCalledOnce());
    expect(vi.mocked(recordShiftExpense).mock.calls[0][0]).toMatchObject({
      shiftId: 'shift', branchId: 'branch', userId: 'cashier', amount: 10000, description: 'Community donation',
    });
    await waitFor(() => expect(readShiftCashReport).toHaveBeenCalledTimes(2));
    expect((screen.getByLabelText('Keterangan') as HTMLTextAreaElement).value).toBe('');
    expect(toast.success).toHaveBeenCalledOnce();
  });

  it('keeps the form and request id on a failed save and prevents overlapping posts', async () => {
    vi.mocked(recordShiftExpense).mockRejectedValueOnce(new Error('Connection interrupted'));
    mount();
    await enterExpense();
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Pengeluaran' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Connection interrupted'));
    const firstId = vi.mocked(recordShiftExpense).mock.calls[0][0].id;
    expect((screen.getByLabelText('Keterangan') as HTMLTextAreaElement).value).toBe('Community donation');
    const pending = deferred<void>();
    vi.mocked(recordShiftExpense).mockReturnValueOnce(pending.promise);
    const save = screen.getByRole('button', { name: 'Simpan Pengeluaran' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(recordShiftExpense).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recordShiftExpense).mock.calls[1][0].id).toBe(firstId);
    expect((screen.getByRole('button', { name: 'Selesai' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { pending.resolve(); });
  });

  it('blocks posting on load failure and allows retry instead of presenting a zero balance', async () => {
    vi.mocked(readShiftCashReport).mockRejectedValueOnce(new Error('Report unavailable'));
    mount();
    expect((await screen.findByRole('alert')).textContent).toContain('Report unavailable');
    expect(screen.queryByText(/Saldo kas laci/)).toBeNull();
    expect((screen.getByRole('button', { name: 'Simpan Pengeluaran' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    await screen.findByText(/Saldo kas laci/);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ignores an old load after the shift changes', async () => {
    const old = deferred<ShiftCashReport>();
    vi.mocked(readShiftCashReport).mockReturnValueOnce(old.promise);
    const view = mount();
    view.rerender(<ShiftExpenseModal {...view.props} shiftId="new-shift" />);
    await screen.findByText(/Saldo kas laci/);
    await act(async () => { old.resolve({ ...report, expectedCash: 999 }); });
    expect(screen.getByText(/Saldo kas laci/).textContent).toContain('140.000');
  });

  it('disables saving when permission is revoked', async () => {
    permissions.allowed = false;
    mount();
    await enterExpense();
    const save = screen.getByRole('button', { name: 'Simpan Pengeluaran' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(recordShiftExpense).not.toHaveBeenCalled();
  });
});

describe('shift close expense reconciliation', () => {
  it('shows expense details and deducts them from cash without reducing sales; retains failed close input', async () => {
    const action = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const change = vi.fn();
    render(<ShiftModal open mode="close" report={report} onOpenChange={change} onShiftAction={action} />);
    expect(screen.getByText('Community donation')).toBeTruthy();
    expect(screen.getByText('Total Penjualan').parentElement?.textContent).toContain('80.000');
    expect(screen.getByText('Saldo Seharusnya').parentElement?.textContent).toContain('140.000');
    const physical = screen.getByPlaceholderText('Masukkan jumlah uang aktual (0 jika laci kosong)');
    fireEvent.change(physical, { target: { value: '140000' } });
    fireEvent.change(screen.getByLabelText('Catatan (Opsional)'), { target: { value: 'Reconciled' } });
    fireEvent.click(screen.getByRole('button', { name: 'Tutup Shift' }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(change).not.toHaveBeenCalled();
    expect((physical as HTMLInputElement).value).toBe('140000');
    expect(action.mock.calls[0][0]).toMatchObject({ actualCash: 140000, notes: 'Reconciled' });
    fireEvent.click(screen.getByRole('button', { name: 'Tutup Shift' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith(false));
  });

  it('cannot close with a missing report', () => {
    const action = vi.fn();
    render(<ShiftModal open mode="close" onOpenChange={vi.fn()} onShiftAction={action} />);
    const close = screen.getByRole('button', { name: 'Tutup Shift' }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.click(close);
    expect(action).not.toHaveBeenCalled();
  });
});
