import { describe, it, expect } from 'vitest';
import { renderReceiptHtml } from '@/lib/print/html-render';
import { buildSaleReceipt, type ReceiptConfig } from '@/lib/print/receipt-doc';
import { columnsForPaper, type PaperWidth } from '@/lib/print/document';

const trx = {
  invoiceNumber: 'INV/1',
  createdAt: '2026-11-06T14:05:00.000Z',
  total: 188500,
  amountPaid: 200000,
  paymentMethod: 'cash',
  cashierName: 'Budi',
  items: [
    { name: 'Tepung Terigu Cakra Kembar', quantity: 2, unitName: 'Pcs', unitPrice: 13500, subtotal: 27000 },
  ],
};

// Courier New advances ~0.6em per glyph; 1mm = 72/25.4pt. A full-width line
// must therefore be no wider than the roll it prints on.
const PT_PER_MM = 72 / 25.4;

function bodyFontSize(html: string): number {
  const m = html.match(/body \{[\s\S]*?font-size: ([\d.]+)pt;/);
  expect(m, 'body font-size present').not.toBeNull();
  return Number(m![1]);
}

describe('renderReceiptHtml paper fitting', () => {
  for (const width of [58, 60, 72, 76, 80] as PaperWidth[]) {
    it(`fits ${columnsForPaper(width)} columns inside ${width}mm`, () => {
      const cfg: ReceiptConfig = { storeName: 'Toko', paperWidthMm: width, showLogo: true };
      const doc = buildSaleReceipt(trx, cfg);
      const html = renderReceiptHtml(doc, width);
      const pt = bodyFontSize(html);
      const textWidthMm = (doc.columns * 0.6 * pt) / PT_PER_MM;
      // Never below a readable size and never wider than the printable area.
      expect(pt).toBeGreaterThanOrEqual(4);
      expect(pt).toBeLessThanOrEqual(11);
      expect(textWidthMm).toBeLessThanOrEqual(width);
    });
  }

  it('scales the double-size header in em, not a fixed 18pt', () => {
    const doc = buildSaleReceipt(trx, { storeName: 'Toko', paperWidthMm: 72, showLogo: true });
    const html = renderReceiptHtml(doc, 72);
    expect(html).toContain('font-size:2em');
    expect(html).not.toContain('font-size:18pt');
  });

  it('drives the @page size from the paper width', () => {
    const doc = buildSaleReceipt(trx, { storeName: 'T', paperWidthMm: 76, showLogo: true });
    const html = renderReceiptHtml(doc, 76);
    expect(html).toContain('@page { size: 76mm auto;');
  });
});
