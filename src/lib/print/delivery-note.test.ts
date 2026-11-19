import { describe, expect, it } from 'vitest';
import { renderDeliveryNoteHtml, type DeliveryNoteInput } from './delivery-note';

const input: DeliveryNoteInput = {
  requestNumber: 'REQ-001', transferNumber: 'TRF-001', dispatchedAt: '2026-11-19T10:00:00Z',
  sourceName: 'Warehouse', destinationName: 'Store Warehouse', outletName: 'Outlet A',
  lines: [{ product_name: 'Milk', sku: 'MILK-C', variant_name: 'Chocolate', quantity_sent: 2, unit_name: 'Carton', conversion_factor: 12 }],
};
describe('actual-dispatch delivery notes', () => {
  it('prints dispatched packs, converted base units and signature blocks on A4', () => {
    const html = renderDeliveryNoteHtml(input);
    for (const value of ['TRF-001', 'REQ-001', 'Chocolate', 'Carton', '>24<', 'Pengirim', 'Pengemudi', 'Penerima', '@page { size: A4 portrait;']) {
      expect(html).toContain(value);
    }
    expect(html).toContain('thead { display: table-header-group; }');
  });
  it('rejects undispatched/empty documents and omits zero-sent items', () => {
    expect(() => renderDeliveryNoteHtml({ ...input, dispatchedAt: null })).toThrow(/belum dikirim/);
    expect(() => renderDeliveryNoteHtml({ ...input, lines: [] })).toThrow(/Tidak ada barang/);
    const html = renderDeliveryNoteHtml({ ...input, lines: [...input.lines, { product_name: 'Never sent', sku: 'NO', quantity_sent: 0, unit_name: 'Pcs', conversion_factor: 1 }] });
    expect(html).not.toContain('Never sent');
  });
  it('escapes every user-controlled label and note', () => {
    const unsafe = '<img src=x onerror="bad()"> & \'Vendor\'';
    const html = renderDeliveryNoteHtml({ ...input, requestNumber: unsafe, sourceName: unsafe, outletName: unsafe,
      notes: '<script>bad()</script>', dispatchedBy: unsafe,
      lines: [{ ...input.lines[0], product_name: unsafe, sku: unsafe, variant_name: unsafe, unit_name: unsafe }],
    });
    expect(html).not.toContain('<img'); expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x onerror=&quot;bad()&quot;&gt; &amp; &#039;Vendor&#039;');
  });
});
