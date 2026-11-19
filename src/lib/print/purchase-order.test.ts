import { describe, expect, it } from 'vitest';
import { renderPurchaseOrderHtml, type PurchaseOrderPrintInput } from './purchase-order';

function document(overrides: Partial<PurchaseOrderPrintInput> = {}): PurchaseOrderPrintInput {
  return {
    poNumber: 'PO-20261120-0001',
    status: 'approved',
    vendorName: 'PT Sumber Makmur',
    warehouseName: 'Gudang Pusat',
    createdAt: '2026-11-20T08:00:00.000Z',
    expectedDate: '2026-11-25',
    paymentTermsDays: 30,
    notes: 'Kirim pagi',
    subtotalAmount: 1_000_000,
    ppnRate: 11,
    ppnAmount: 110_000,
    totalAmount: 1_110_000,
    lines: [
      {
        productName: 'Tepung Premium',
        sku: 'TEP-001',
        variantName: 'Protein Tinggi',
        quantity: 10,
        unitName: 'Sak',
        unitCost: 100_000,
        subtotal: 1_000_000,
      },
    ],
    ...overrides,
  };
}

describe('A4 purchase-order document', () => {
  it('renders stored net, PPN, and gross values with document metadata', () => {
    const html = renderPurchaseOrderHtml(document());
    expect(html).toContain('PO-20261120-0001');
    expect(html).toContain('PT Sumber Makmur');
    expect(html).toContain('Protein Tinggi');
    expect(html).toContain('PPN 11%');
    expect(html).toContain('Total Pembayaran');
    expect(html).toContain('1.110.000');
    expect(html).toContain('bukan faktur pajak');
  });

  it('prints the saved discount and DPP before PPN without recalculating history', () => {
    const html = renderPurchaseOrderHtml(document({ discountType: 'percent', discountValue: 10,
      discountAmount: 100_000, ppnAmount: 99_000, totalAmount: 999_000 }));
    expect(html).toContain('100.000'); expect(html).toContain('900.000'); expect(html).toContain('999.000');
    expect(html.indexOf('Diskon')).toBeLessThan(html.lastIndexOf('PPN 11%'));
  });

  it('renders zero-tax saved documents as Non-PPN', () => {
    const html = renderPurchaseOrderHtml(
      document({ ppnRate: 0, ppnAmount: 0, totalAmount: 1_000_000 })
    );
    expect(html).toContain('Non-PPN');
    expect(html).toContain('PPN (Non-PPN)');
  });

  it.each([
    ['draft', 'Draf'],
    ['submitted', 'Menunggu Persetujuan'],
    ['approved', 'Disetujui'],
    ['partially_received', 'Diterima Sebagian'],
    ['received', 'Diterima'],
    ['rejected', 'Ditolak'],
    ['cancelled', 'Dibatalkan'],
  ] as const)('labels %s documents conspicuously', (status, label) => {
    expect(renderPurchaseOrderHtml(document({ status }))).toContain(
      `<div class="status">${label}</div>`
    );
  });

  it('escapes user-controlled values and supports long tables', () => {
    const malicious = '<img src=x onerror="alert(1)"> & Vendor';
    const lines = Array.from({ length: 60 }, (_, index) => ({
      productName: `${malicious} ${index}`,
      sku: `SKU-${index}`,
      variantName: '<script>bad()</script>',
      quantity: 1,
      unitName: 'Pcs',
      unitCost: 100,
      subtotal: 100,
    }));
    const html = renderPurchaseOrderHtml(
      document({ vendorName: malicious, notes: '<b>unsafe</b>', lines })
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>unsafe</b>');
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; Vendor');
    expect(html.match(/<tr>/g)?.length).toBe(61);
    expect(html).toContain('thead { display: table-header-group; }');
    expect(html).toContain('@page { size: A4 portrait;');
  });
});
