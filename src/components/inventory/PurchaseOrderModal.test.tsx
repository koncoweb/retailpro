// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { PurchaseOrderModal, type PurchaseOrderDraftValues } from './PurchaseOrderModal';

vi.mock('@/lib/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) =>
    <select value={value} onChange={(e) => onValueChange(e.target.value)}><option value="" />{children}</select>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));
afterEach(cleanup);
const draft: PurchaseOrderDraftValues = {
  supplierId: 'vendor-1', supplierName: 'Vendor', paymentTermsDays: 14, destinationWarehouseId: 'warehouse-1', expectedDate: '', notes: '',
  items: [{ productId: 'p1', productName: 'Milk', sku: 'MILK', variantId: null, quantity: 2, unitName: 'Pcs', conversionFactor: 1, unitCost: 1000, subtotal: 2000 }],
  subtotalAmount: 2000, discountType: 'percent', discountValue: 10, discountAmount: 200, ppnRate: 11, ppnAmount: 198, totalAmount: 1998,
};
function setup() {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(<PurchaseOrderModal open onOpenChange={vi.fn()} initialDraft={draft} products={[]}
    vendors={[{ id: 'vendor-1', name: 'Vendor', ppn_enabled: 0 }]}
    warehouses={[{ id: 'warehouse-1', name: 'Warehouse', code: 'WH', type: 'central', branch_id: null, status: 'active', is_default: 1 }]}
    onSubmit={onSubmit} />);
  return onSubmit;
}
describe('PO discount editor', () => {
  it('hydrates and saves its discount and tax snapshot despite a vendor master change', async () => {
    const onSubmit = setup();
    expect((screen.getByLabelText('Nilai Diskon PO') as HTMLInputElement).value).toBe('10');
    expect(within(screen.getByText('Total Pembayaran:').closest('tr')!).getByText('Rp 1.998')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draf' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ discountType: 'percent', discountValue: 10, discountAmount: 200, ppnRate: 11, ppnAmount: 198, totalAmount: 1998 });
  });
  it('calculates a fixed discount before tax and rejects excessive amounts', async () => {
    const onSubmit = setup();
    const selector = screen.getAllByRole('combobox').find((element) => element instanceof HTMLSelectElement && Array.from(element.options).some((option) => option.value === 'amount'))!;
    fireEvent.change(selector, { target: { value: 'amount' } });
    fireEvent.change(screen.getByLabelText('Nilai Diskon PO'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draf' }));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Nilai Diskon PO'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & Ajukan' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]).toMatchObject([{ discountType: 'amount', discountValue: 500, discountAmount: 500, ppnAmount: 165, totalAmount: 1665 }, { submit: true }]);
  });
});
