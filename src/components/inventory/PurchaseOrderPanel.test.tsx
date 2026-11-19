// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { toast } from 'sonner';
import { batchQuery, query, runTransaction } from '@/lib/db';
import { printPurchaseOrder, renderPurchaseOrderHtml } from '@/lib/print/purchase-order';
import type { PurchaseOrderRow } from './PurchaseOrderDetail';
import { PurchaseOrderPanel } from './PurchaseOrderPanel';

vi.mock('@/lib/db', () => ({ query: vi.fn(), batchQuery: vi.fn(), runTransaction: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAuditTx: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ user: { id: 'reader', assigned_branch_id: null } }) }));
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({ can: () => false }),
  useWarehouseScope: () => ({ warehouseIds: null }),
}));
vi.mock('@/components/auth/PermissionGate', () => ({ PermissionGate: () => null }));
vi.mock('@/components/inventory/PurchaseOrderModal', () => ({ PurchaseOrderModal: () => null }));
vi.mock('@/components/inventory/GoodsReceiptModal', () => ({ GoodsReceiptModal: () => null }));
vi.mock('@/lib/warehouse', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/warehouse')>(),
  resolveSupplyWarehouse: async () => null,
}));
vi.mock('@/lib/print/purchase-order', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/print/purchase-order')>(),
  printPurchaseOrder: vi.fn(),
}));

afterEach(cleanup);
function order(id: string, overrides: Partial<PurchaseOrderRow> = {}): PurchaseOrderRow {
  return {
    id, po_number: `PO-${id}`, status: 'draft', supplier_id: 'vendor', supplier_name: 'Vendor',
    branch_id: null, warehouse_id: 'warehouse', subtotal_amount: 2000,
    discount_type: 'amount', discount_value: 500, discount_amount: 500,
    ppn_rate: 11, ppn_amount: 165, total_amount: 1665,
    expected_date: null, created_at: '2026-11-19T08:00:00Z', received_at: null,
    notes: 'Saved notes', payment_terms_days: 14, created_by: null, created_by_name: null,
    submitted_by: null, submitted_by_name: null, submitted_at: null,
    approved_by: null, approved_by_name: null, approved_at: null,
    rejected_by: null, rejected_by_name: null, rejected_at: null,
    cancelled_by: null, cancelled_by_name: null, cancelled_at: null,
    rejection_reason: null, cancel_reason: null, received_amount: 0, receipt_count: 0,
    ...overrides,
  };
}
const rows = [order('first'), order('second', { status: 'cancelled' })];
function detailResults(header = order('second', { status: 'received', notes: 'Latest notes' })) {
  return [
    { rows: [header], rowCount: 1 },
    { rows: [{ id: 'line', product_id: 'milk', product_name: 'Milk', sku: 'MILK',
      variant_id: 'variant', variant_name: 'Vanilla', quantity: 2, quantity_received: 2,
      unit_name: 'Carton', conversion_factor: 12, unit_cost: 1000, subtotal: 2000 }], rowCount: 1 },
    { rows: [], rowCount: 0 },
  ];
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(query).mockResolvedValue({ rows, rowCount: rows.length });
  vi.mocked(batchQuery).mockResolvedValue(detailResults());
});
async function setup() {
  render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <PurchaseOrderPanel products={[]} vendors={[]} warehouses={[
      { id: 'warehouse', name: 'Warehouse', code: 'WH', type: 'central', status: 'active', branch_id: null, is_default: 1 },
    ]} />
  </MemoryRouter>);
  return await screen.findByRole('button', { name: 'Cetak PO-second' });
}

describe('PO list printing', () => {
  it('prints the selected row with freshly loaded status, lines, and saved financial values without writes', async () => {
    const button = await setup();
    expect(screen.getAllByRole('button', { name: /^Cetak PO-/ })).toHaveLength(2);
    fireEvent.click(button);
    await waitFor(() => expect(printPurchaseOrder).toHaveBeenCalledOnce());
    expect(batchQuery).toHaveBeenCalledOnce();
    expect(vi.mocked(batchQuery).mock.calls[0][0].map((statement) => statement.params)).toEqual([
      ['second'], ['second'], ['second'],
    ]);
    const input = vi.mocked(printPurchaseOrder).mock.calls[0][0];
    expect(input).toMatchObject({ poNumber: 'PO-second', status: 'received', notes: 'Latest notes',
      warehouseName: 'Warehouse · bersama', subtotalAmount: 2000, discountAmount: 500, ppnAmount: 165, totalAmount: 1665,
      lines: [{ productName: 'Milk', variantName: 'Vanilla', quantity: 2, unitName: 'Carton', unitCost: 1000 }] });
    expect(renderPurchaseOrderHtml(input)).toContain('<div class="status">Diterima</div>');
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('prevents repeated or competing row clicks while the print data loads', async () => {
    let resolve!: (value: ReturnType<typeof detailResults>) => void;
    vi.mocked(batchQuery).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const button = await setup();
    fireEvent.click(button);
    fireEvent.click(button);
    const other = screen.getByRole('button', { name: 'Cetak PO-first' });
    expect((other as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(other);
    expect(batchQuery).toHaveBeenCalledOnce();
    await act(async () => resolve(detailResults()));
    expect(printPurchaseOrder).toHaveBeenCalledOnce();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('does not print a missing PO and allows retry after the load fails', async () => {
    vi.mocked(batchQuery).mockResolvedValueOnce([{ rows: [], rowCount: 0 }, { rows: [], rowCount: 0 }, { rows: [], rowCount: 0 }]);
    const button = await setup();
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Purchase order tidak ditemukan'));
    expect(printPurchaseOrder).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(printPurchaseOrder).toHaveBeenCalledOnce());
  });

  it('surfaces database and print errors and releases the loading state', async () => {
    vi.mocked(batchQuery).mockRejectedValueOnce(new Error('Load failed'));
    const button = await setup();
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Load failed'));
    vi.mocked(printPurchaseOrder).mockImplementationOnce(() => { throw new Error('Print failed'); });
    fireEvent.click(button);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Print failed'));
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(printPurchaseOrder).toHaveBeenCalledTimes(2));
    vi.mocked(printPurchaseOrder).mock.calls[1][1]?.onError?.(new Error('Frame failed'));
    expect(toast.error).toHaveBeenCalledWith('Frame failed');
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it('keeps detail printing consistent with the row print payload', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'PO-second' }));
    const button = await screen.findByRole('button', { name: 'Cetak / Simpan PDF' });
    fireEvent.click(button);
    expect(printPurchaseOrder).toHaveBeenCalledOnce();
    const detailInput = vi.mocked(printPurchaseOrder).mock.calls[0][0];
    fireEvent.click(screen.getByRole('button', { name: 'Tutup' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cetak PO-second' }));
    await waitFor(() => expect(printPurchaseOrder).toHaveBeenCalledTimes(2));
    expect(vi.mocked(printPurchaseOrder).mock.calls[1][0]).toEqual(detailInput);
  });
});
