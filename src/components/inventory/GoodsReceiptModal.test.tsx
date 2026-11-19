// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GoodsReceiptModal, type ReceiptLineSource } from './GoodsReceiptModal';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
afterEach(cleanup);
const lines: ReceiptLineSource[] = [{ purchaseOrderItemId: 'line-1', productId: 'p1', productName: 'Milk', sku: 'MILK',
  ordered: 1, alreadyReceived: 0.666, previousValue: 3.33, previousSubtotal: 3,
  unitName: 'Kg', conversionFactor: 1, unitCost: 5,
}];
const context = { poSubtotal: 5, poDiscountAmount: 1, previousSubtotal: 3, previousDiscount: 1, previousPpn: 0 };
function setup(amountContext = context) {
  const onSubmit = vi.fn().mockResolvedValue(undefined), onOpenChange = vi.fn();
  render(<GoodsReceiptModal open onOpenChange={onOpenChange} poNumber="PO-001" vendorName="Vendor" warehouseName="Warehouse"
    lines={lines} requireExpiry={false} ppnRate={11} amountContext={amountContext} onSubmit={onSubmit} />);
  return { onSubmit, onOpenChange };
}
describe('receipt preview and submission', () => {
  it('shows the same fractional final receipt amount used by the write path', async () => {
    const { onSubmit, onOpenChange } = setup();
    const totalRow = screen.getByText('Total tagihan:').closest('tr')!;
    expect(within(totalRow).getByText('Rp 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Simpan Penerimaan' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0][0].lines[0]).toMatchObject({ purchaseOrderItemId: 'line-1', quantity: 0.334, unitCost: 5 });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
  it('displays a validation error instead of crashing when a price override cannot absorb the discount', () => {
    const { onSubmit } = setup({ ...context, poDiscountAmount: 2, previousDiscount: 0 });
    fireEvent.change(screen.getAllByRole('spinbutton')[1], { target: { value: '0' } });
    expect(screen.getByRole('alert').textContent).toContain('Sisa diskon PO');
    expect((screen.getByRole('button', { name: 'Simpan Penerimaan' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
