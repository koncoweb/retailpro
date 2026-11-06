import { describe, it, expect } from 'vitest';
import { buildShiftZReport, type ZReportInput } from '@/lib/print/zreport-doc';
import { resolveLineText, columnsForPaper } from '@/lib/print/document';

const CFG = {
  storeName: 'Toko Bahan Kue Thalia',
  footer: 'Terima kasih',
  paperWidthMm: 80 as const,
  showLogo: true,
};

const baseInput: ZReportInput = {
  shiftId: '3a1c9f20-1234-5678-9abc-def012345678',
  startTime: '2026-11-06T01:02:00.000Z',
  endTime: '2026-11-06T13:15:00.000Z',
  cashierName: 'Budi',
  branchName: 'Depok',
  transactionCount: 42,
  byMethod: { cash: 1250000, card: 430000, ewallet: 120000, qris: 85000 },
  totalSales: 1885000,
  initialCash: 200000,
  expectedCash: 1450000,
  finalCash: 1450000,
  difference: 0,
  notes: null,
};

describe('buildShiftZReport', () => {
  it('keeps every line inside the paper width', () => {
    const doc = buildShiftZReport(baseInput, CFG);
    expect(doc.columns).toBe(columnsForPaper(80));
    for (const line of [...doc.header, ...doc.body, ...doc.footer]) {
      expect(resolveLineText(line, doc.columns).length).toBeLessThanOrEqual(doc.columns);
    }
  });

  it('prints all four payment methods so the totals add up on paper', () => {
    const doc = buildShiftZReport(baseInput, CFG);
    const labels = doc.body.filter((l) => l.cols).map((l) => l.cols![0]);
    expect(labels).toEqual(expect.arrayContaining(['Tunai', 'Kartu', 'E-Wallet', 'QRIS']));
    const total = doc.body.find((l) => l.cols?.[0] === 'TOTAL PENJUALAN');
    expect(total?.cols?.[1]).toBe('Rp 1.885.000');
  });

  it('marks a balanced drawer, and shows the signed amount when it is off', () => {
    const balanced = buildShiftZReport(baseInput, CFG);
    const bSelisih = balanced.body.find((l) => l.cols?.[0] === 'Selisih');
    expect(bSelisih?.cols?.[1]).toBe('Rp 0 (sesuai)');

    const short = buildShiftZReport({ ...baseInput, finalCash: 1400000, difference: -50000 }, CFG);
    const sSelisih = short.body.find((l) => l.cols?.[0] === 'Selisih');
    expect(sSelisih?.cols?.[1]).toBe('-Rp 50.000');
  });

  it('omits the notes block when the cashier wrote none', () => {
    const withoutNotes = buildShiftZReport(baseInput, CFG);
    expect(withoutNotes.body.some((l) => l.text?.startsWith('Catatan'))).toBe(false);

    const withNotes = buildShiftZReport({ ...baseInput, notes: 'Laci macet' }, CFG);
    expect(withNotes.body.some((l) => l.text?.includes('Laci macet'))).toBe(true);
  });

  it('keeps amount lines within the width on 58mm (free text may soft-wrap)', () => {
    const doc = buildShiftZReport(
      {
        ...baseInput,
        byMethod: { cash: 99999999, card: 88888888, ewallet: 77777777, qris: 66666666 },
        totalSales: 333333330,
      },
      { ...CFG, paperWidthMm: 58 }
    );
    expect(doc.columns).toBe(32);
    // Amounts live in `cols` lines and must never wrap; the "Selesai" timestamp
    // row is free text and folds at the paper edge.
    for (const line of [...doc.header, ...doc.body, ...doc.footer]) {
      if (!line.cols) continue;
      expect(resolveLineText(line, doc.columns).length).toBeLessThanOrEqual(32);
    }
  });

  it('reconciles the per-method breakdown, adding "Lainnya" only when a method falls outside the four buckets', () => {
    const cents = (s: string | undefined) => Number((s ?? '0').replace(/[^0-9-]/g, ''));
    const withOther = buildShiftZReport(
      {
        ...baseInput,
        // e.g. a 'credit' sale the till filed outside the named buckets.
        byMethod: { cash: 1000000, card: 300000, ewallet: 100000, qris: 50000, other: 25000 },
        totalSales: 1475000,
      },
      CFG,
    );
    const rows = withOther.body.filter((l) => l.cols).map((l) => l.cols!);
    expect(rows.some((c) => c[0] === 'Lainnya')).toBe(true);
    const sum = ['Tunai', 'Kartu', 'E-Wallet', 'QRIS', 'Lainnya']
      .map((k) => cents(rows.find((c) => c[0] === k)?.[1]))
      .reduce((a, b) => a + b, 0);
    expect(sum).toBe(1475000);
    expect(rows.find((c) => c[0] === 'TOTAL PENJUALAN')?.[1]).toBe('Rp 1.475.000');

    // No leftover → no extra line, and the four methods already equal the total.
    const noOther = buildShiftZReport(baseInput, CFG);
    expect(noOther.body.some((l) => l.cols?.[0] === 'Lainnya')).toBe(false);
  });
});
