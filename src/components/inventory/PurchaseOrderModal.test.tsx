// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { PurchaseOrderModal, type PurchaseOrderDraftValues, type PurchaseOrderProduct } from './PurchaseOrderModal';

vi.mock('@/lib/db', () => ({ query: vi.fn().mockResolvedValue({ rows: [] }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandInput: () => <input placeholder="Cari produk..." />,
  CommandList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandEmpty: () => null,
  CommandGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  CommandItem: ({ children, onSelect }: { children: ReactNode; onSelect: () => void }) => <button role="option" onClick={onSelect}>{children}</button>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: ReactNode }) =>
    <select value={value} onChange={(e) => onValueChange(e.target.value)}><option value="" />{children}</select>,
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => <option value={value}>{children}</option>,
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());
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
const products: PurchaseOrderProduct[] = ['Milk', 'Flour'].map((name, index) => ({
  id: `p${index + 1}`, name, sku: name.toUpperCase(), stock: 10, minStock: 0,
  cost: 1000, supplier: 'Vendor', supplierId: 'vendor-1', warehouses: {}, units: [],
  variants: [{ id: `v${index + 1}`, sku: `${name.toUpperCase()}-V`, attributes: {}, cost: 1000, price: 1500, units: [] }],
}));
function setupNew(defaultWarehouseId: string | null = 'warehouse-1', onSubmit = vi.fn().mockResolvedValue(undefined)) {
  const props = { open: true, onOpenChange: vi.fn(), products,
    vendors: [{ id: 'vendor-1', name: 'Vendor', ppn_enabled: 1 }],
    warehouses: [{ id: 'warehouse-1', name: 'Warehouse', code: 'WH', type: 'central', branch_id: null, status: 'active', is_default: 1 }],
    defaultWarehouseId, onSubmit };
  return { ...render(<PurchaseOrderModal {...props} />), props, onSubmit };
}
function pickProduct(name: string, quantity = '1') {
  fireEvent.click(document.getElementById('po-product-picker')!);
  fireEvent.click(screen.getByRole('option', { name: new RegExp(name) }));
  fireEvent.change(screen.getByPlaceholderText('Jumlah'), { target: { value: quantity } });
}
describe('PO first product entry', () => {
  it('saves a single selected product without requiring the plus button or a second product', async () => {
    const { onSubmit } = setupNew();
    pickProduct('Milk', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draf' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ items: [{ productId: 'p1', variantId: 'v1', quantity: 2 }], subtotalAmount: 2000, ppnAmount: 220, totalAmount: 2220 });
  });
  it('saves exactly one explicitly added product', async () => {
    const { onSubmit } = setupNew();
    pickProduct('Milk');
    fireEvent.click(screen.getByRole('button', { name: 'Tambahkan baris ke order' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & Ajukan' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].items).toHaveLength(1);
  });
  it('includes the last selected product and recalculates discounts before PPN', async () => {
    const { onSubmit } = setupNew();
    pickProduct('Milk');
    fireEvent.click(screen.getByRole('button', { name: 'Tambahkan baris ke order' }));
    pickProduct('Flour', '2');
    const selector = screen.getAllByRole('combobox').find((element) => element instanceof HTMLSelectElement && Array.from(element.options).some((option) => option.value === 'percent'))!;
    fireEvent.change(selector, { target: { value: 'percent' } });
    fireEvent.change(screen.getByLabelText('Nilai Diskon PO'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan & Ajukan' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].items).toHaveLength(2);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ subtotalAmount: 3000, discountAmount: 300, ppnAmount: 297, totalAmount: 2997 });
  });
  it('does not erase the first product when the default warehouse resolves later', async () => {
    const { onSubmit, props, rerender } = setupNew(null);
    pickProduct('Milk');
    fireEvent.click(screen.getByRole('button', { name: 'Tambahkan baris ke order' }));
    rerender(<PurchaseOrderModal {...props} defaultWarehouseId="warehouse-1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draf' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].items).toHaveLength(1);
  });
  it('accepts a fixed discount against the pending single-product subtotal', async () => {
    const { onSubmit } = setupNew();
    pickProduct('Milk', '2');
    const selector = screen.getAllByRole('combobox').find((element) => element instanceof HTMLSelectElement && Array.from(element.options).some((option) => option.value === 'amount'))!;
    fireEvent.change(selector, { target: { value: 'amount' } });
    fireEvent.change(screen.getByLabelText('Nilai Diskon PO'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draf' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ subtotalAmount: 2000, discountAmount: 500, ppnAmount: 165, totalAmount: 1665 });
  });
  it('merges the final selection into the matching variant and pack without duplicate rows', async () => {
    const { onSubmit } = setupNew();
    pickProduct('Milk');
    fireEvent.click(screen.getByRole('button', { name: 'Tambahkan baris ke order' }));
    pickProduct('Milk', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draf' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].items).toMatchObject([{ productId: 'p1', variantId: 'v1', quantity: 3, subtotal: 3000 }]);
    expect(onSubmit.mock.calls[0][0].items).toHaveLength(1);
  });
  it('retains the final line after a failed save without adding it again on retry', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error('Save failed')).mockResolvedValueOnce(undefined);
    const { props } = setupNew('warehouse-1', onSubmit);
    pickProduct('Milk', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draf' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Save failed'));
    expect(props.onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draf' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0].items).toMatchObject([{ quantity: 2, subtotal: 2000 }]);
    expect(onSubmit.mock.calls[1][0].items).toHaveLength(1);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });
  it('preserves a manually selected destination when a warehouse suggestion arrives', async () => {
    const { onSubmit, props, rerender } = setupNew(null);
    const warehouseSelect = screen.getAllByRole('combobox').find((element) => element instanceof HTMLSelectElement && Array.from(element.options).some((option) => option.value === 'warehouse-1'))!;
    fireEvent.change(warehouseSelect, { target: { value: 'warehouse-1' } });
    pickProduct('Milk');
    rerender(<PurchaseOrderModal {...props} defaultWarehouseId="warehouse-2" />);
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draf' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].destinationWarehouseId).toBe('warehouse-1');
  });
  it('resets the previous product when the new-order dialog is reopened', () => {
    const { props, rerender } = setupNew();
    pickProduct('Milk');
    fireEvent.click(screen.getByRole('button', { name: 'Tambahkan baris ke order' }));
    rerender(<PurchaseOrderModal {...props} open={false} />);
    rerender(<PurchaseOrderModal {...props} />);
    expect(screen.queryByText('Milk')).toBeNull();
    expect((screen.getByPlaceholderText('Jumlah') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draf' }));
    expect(props.onSubmit).not.toHaveBeenCalled();
  });
  it('still rejects an empty order or invalid pending quantity', () => {
    const { onSubmit } = setupNew();
    const vendorSelect = screen.getAllByRole('combobox').find((element) => element instanceof HTMLSelectElement && Array.from(element.options).some((option) => option.value === 'vendor-1'))!;
    fireEvent.change(vendorSelect, { target: { value: 'vendor-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draf' }));
    expect(toast.error).toHaveBeenCalledWith('Tambahkan minimal 1 produk');
    pickProduct('Milk', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Draf' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
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
