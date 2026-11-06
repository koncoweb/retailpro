import { describe, it, expect } from 'vitest';
import {
  buildSaleReceipt,
  type ReceiptConfig,
  type SaleReceiptInput,
} from '@/lib/print/receipt-doc';
import {
  resolveLineText,
  columnsForPaper,
  normalizePaperWidth,
  PAPER_WIDTHS,
} from '@/lib/print/document';

const CFG_80: ReceiptConfig = {
  storeName: 'Toko Bahan Kue Thalia',
  storeAddress: 'Jl. Depok Raya 12',
  footer: 'Terima kasih atas kunjungan Anda!',
  paperWidthMm: 80,
  showLogo: true,
};

const baseTrx: SaleReceiptInput = {
  invoiceNumber: 'INV/1700000000000',
  createdAt: '2026-11-06T14:05:00.000Z',
  total: 23000,
  amountPaid: 50000,
  paymentMethod: 'cash',
  cashierName: 'Budi',
  branchName: 'Depok',
  customerName: null,
  items: [
    { name: 'Tepung Terigu', quantity: 2, unitName: 'Pcs', unitPrice: 10000, subtotal: 20000 },
    { name: 'Gula Pasir', quantity: 1, unitName: 'Kg', unitPrice: 3000, subtotal: 3000 },
  ],
};

describe('buildSaleReceipt', () => {
  it('renders every line within the 48-column budget', () => {
    const doc = buildSaleReceipt(baseTrx, CFG_80);
    expect(doc.columns).toBe(columnsForPaper(80));
    const all = [...doc.header, ...doc.body, ...doc.footer];
    for (const line of all) {
      expect(resolveLineText(line, doc.columns).length).toBeLessThanOrEqual(48);
    }
  });

  it('computes change from tender minus total', () => {
    const doc = buildSaleReceipt(baseTrx, CFG_80);
    const kembali = doc.body.find((l) => l.cols?.[0] === 'Kembali');
    expect(kembali?.cols?.[1]).toBe('Rp 27.000');
  });

  it('derives the discount line from the item sum minus total', () => {
    // items sum 23.000 but total is 20.000 → a 3.000 discount was applied.
    const doc = buildSaleReceipt(
      { ...baseTrx, total: 20000 },
      CFG_80
    );
    const diskon = doc.body.find((l) => l.cols?.[0] === 'Diskon');
    expect(diskon?.cols?.[1]).toBe('-Rp 3.000');
  });

  it('falls back to Walk-in when no member is attached', () => {
    const doc = buildSaleReceipt(baseTrx, CFG_80);
    const customer = doc.body.find((l) => l.text?.startsWith('Pelanggan'));
    expect(customer?.text).toContain('Walk-in');
  });

  it('keeps amount lines within the width on 58mm (free text may soft-wrap)', () => {
    const doc = buildSaleReceipt(
      {
        ...baseTrx,
        items: [
          {
            name: 'Keripik Singkong Balado Pedas Level 100 Super Renyah',
            quantity: 1,
            unitName: 'Sachet',
            unitPrice: 8000,
            subtotal: 8000,
          },
        ],
        total: 8000,
        amountPaid: 8000,
      },
      { ...CFG_80, paperWidthMm: 58 }
    );
    expect(doc.columns).toBe(32);
    // Only the two-column (amount-bearing) lines must fit exactly; a long
    // product name folds into the label shrink, and free text soft-wraps.
    for (const line of [...doc.header, ...doc.body, ...doc.footer]) {
      if (!line.cols) continue;
      expect(resolveLineText(line, doc.columns).length).toBeLessThanOrEqual(32);
    }
  });

  it('maps every supported paper width to its column count', () => {
    expect(columnsForPaper(58)).toBe(32);
    expect(columnsForPaper(60)).toBe(32);
    expect(columnsForPaper(72)).toBe(42);
    expect(columnsForPaper(76)).toBe(44);
    expect(columnsForPaper(80)).toBe(48);
    // The picker iterates this list, so every option is representable.
    for (const w of PAPER_WIDTHS) expect(columnsForPaper(w)).toBeGreaterThan(0);
  });

  it('snaps stale or hand-edited widths to a supported size', () => {
    expect(normalizePaperWidth(76)).toBe(76);
    expect(normalizePaperWidth(70)).toBe(80); // unsupported → default
    expect(normalizePaperWidth('58')).toBe(58); // numeric string ok
    expect(normalizePaperWidth(undefined)).toBe(80);
  });

  it('lays a sale receipt out within the chosen width', () => {
    const doc = buildSaleReceipt(baseTrx, { ...CFG_80, paperWidthMm: 72 });
    expect(doc.columns).toBe(42);
    for (const line of [...doc.header, ...doc.body, ...doc.footer]) {
      if (!line.cols) continue;
      expect(resolveLineText(line, doc.columns).length).toBeLessThanOrEqual(42);
    }
  });
});
