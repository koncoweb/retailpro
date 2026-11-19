// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { StockTransferModal, type TransferProduct } from './StockTransferModal';

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

const products: TransferProduct[] = [{ id: 'p1', name: 'Milk', sku: 'MILK', stock_by_warehouse: { source: 100 }, variants: [
  { id: 'v1', label: 'Chocolate', sku: 'MILK-C', barcode: 'BASE-C', warehouses: { source: 25 }, units: [
    { name: 'Pcs', conversion_factor: 1, barcode: 'PIECE-C' },
    { name: 'Carton', conversion_factor: 12, barcode: 'CARTON-C' },
  ] },
  { id: 'v2', label: 'Vanilla', sku: 'MILK-V', barcode: 'BASE-V', warehouses: {}, units: [] },
]}];
const warehouses = [
  { id: 'source', name: 'Source', code: 'SRC', type: 'central', branch_id: null, status: 'active', is_default: 1 },
  { id: 'destination', name: 'Destination', code: 'DST', type: 'central', branch_id: null, status: 'active', is_default: 0 },
];
function setup(onTransfer = vi.fn().mockResolvedValue(undefined)) {
  const onOpenChange = vi.fn();
  render(<StockTransferModal open onOpenChange={onOpenChange} products={products} warehouses={warehouses} onTransfer={onTransfer} />);
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'source' } });
  fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: 'destination' } });
  return { onTransfer, onOpenChange };
}
function scan(code: string) {
  const input = screen.getByLabelText('Scan barcode transfer');
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('stock transfer scanning UI', () => {
  it('merges rapid pack scans and reserves stock across every pack of a variant', async () => {
    const { onTransfer } = setup();
    act(() => {
      for (const code of ['CARTON-C', 'CARTON-C', 'PIECE-C', 'PIECE-C']) {
        for (const key of code) fireEvent.keyDown(document.body, { key });
        fireEvent.keyDown(document.body, { key: 'Enter' });
      }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Proses Transfer' }));
    await waitFor(() => expect(onTransfer).toHaveBeenCalledOnce());
    expect(onTransfer.mock.calls[0][0]).toMatchObject({ from: 'source', to: 'destination', items: [
      { productId: 'p1', variantId: 'v1', quantity: 2, unitName: 'Carton', conversionFactor: 12 },
      { productId: 'p1', variantId: 'v1', quantity: 1, unitName: 'Pcs', conversionFactor: 1 },
    ] });
  });

  it('does not borrow another variant’s stock or react to barcode typing in notes', () => {
    setup(); scan('BASE-V');
    expect(screen.queryByText('1 Pcs')).toBeNull();
    const notes = screen.getByPlaceholderText('Catatan transfer...');
    for (const key of 'PIECE-C') fireEvent.keyDown(notes, { key });
    fireEvent.keyDown(notes, { key: 'Enter' });
    expect(screen.queryByText('1 Pcs')).toBeNull();
    scan('BASE-C'); expect(screen.getByText('1 Pcs')).toBeTruthy();
  });

  it('keeps lines and the dialog open on failure, then submits successfully on retry', async () => {
    const onTransfer = vi.fn().mockRejectedValueOnce(new Error('Transfer failed')).mockResolvedValueOnce(undefined);
    const { onOpenChange } = setup(onTransfer); scan('PIECE-C');
    fireEvent.click(screen.getByRole('button', { name: 'Proses Transfer' }));
    await waitFor(() => expect(onTransfer).toHaveBeenCalledOnce());
    await waitFor(() => expect((screen.getByRole('button', { name: 'Proses Transfer' }) as HTMLButtonElement).disabled).toBe(false));
    expect(onOpenChange).not.toHaveBeenCalled(); expect(screen.getByText('1 Pcs')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Proses Transfer' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onTransfer).toHaveBeenCalledTimes(2);
  });
});
