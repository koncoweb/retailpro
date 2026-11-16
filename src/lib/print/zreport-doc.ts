/**
 * Shift-close report (Z-report) builder.
 *
 * The cashier's end-of-shift reconciliation, laid out to be read off the
 * paper in one pass: who/where/when, sales split per payment method, then the
 * cash drawer math (modal awal → saldo yang harus ada → kas fisik → selisih).
 * Everything here already exists as a number in `shifts` and the per-shift
 * transactions; the builder only decides the order and the columns.
 *
 * Ringkas is a hard requirement — a Z-report that runs past ~60 lines gets
 * skimmed, and a skipped selisih line is how drawer losses stay hidden.
 */
import {
  blankLine,
  dividerLine,
  durationLabel,
  rupiah,
  stampDate,
  columnsForPaper,
  type PrintDoc,
  type PrintDocLine,
} from '@/lib/print/document';
import type { ReceiptConfig } from '@/lib/print/receipt-doc';

/** The closed shift row plus the display names joined at print time. */
export interface ZReportInput {
  shiftId: string;
  startTime: string;
  endTime: string;
  cashierName?: string | null;
  branchName?: string | null;
  /** Transaction count posted against this shift. */
  transactionCount: number;
  /** Sales per payment method, in rupiah; zero methods still print so the
   *  totals visibly add up on paper. `other` catches any method outside the
   *  four named buckets so the breakdown always equals TOTAL PENJUALAN. */
  byMethod: { cash: number; card: number; ewallet: number; qris: number; other?: number };
  totalSales: number;
  /** Whole-bon voids in this shift, shown for reconciliation (009). */
  voidCount?: number;
  voidAmount?: number;
  initialCash: number;
  expectedCash: number;
  finalCash: number;
  difference: number;
  notes?: string | null;
}

function label3(text: string): string {
  return text.toUpperCase();
}

export function buildShiftZReport(input: ZReportInput, cfg: ReceiptConfig): PrintDoc {
  const columns = columnsForPaper(cfg.paperWidthMm);
  const heavy = dividerLine(columns, '=');

  const header: PrintDocLine[] = [
    heavy,
    { text: cfg.storeName, size: 2, align: 'center', bold: true },
    { text: 'LAPORAN TUTUP SHIFT', align: 'center', bold: true },
    heavy,
  ];

  const body: PrintDocLine[] = [
    { text: `No Shift : ${input.shiftId.slice(0, 8)}` },
    { text: `Kasir    : ${input.cashierName ?? '-'}` },
    { text: `Cabang   : ${input.branchName ?? '-'}` },
    dividerLine(columns),
    { text: `Mulai    : ${stampDate(input.startTime)}` },
    {
      text: `Selesai  : ${stampDate(input.endTime)} (${durationLabel(input.startTime, input.endTime)})`,
    },
    { text: `Transaksi: ${input.transactionCount}` },
    dividerLine(columns),
    { text: label3('penjualan per metode'), bold: true },
    { cols: ['Tunai', rupiah(input.byMethod.cash)] },
    { cols: ['Kartu', rupiah(input.byMethod.card)] },
    { cols: ['E-Wallet', rupiah(input.byMethod.ewallet)] },
    { cols: ['QRIS', rupiah(input.byMethod.qris)] },
    ...(input.byMethod.other && input.byMethod.other > 0
      ? [{ cols: ['Lainnya', rupiah(input.byMethod.other)] } as PrintDocLine]
      : []),
    { cols: ['TOTAL PENJUALAN', rupiah(input.totalSales)], bold: true },
    ...(input.voidCount && input.voidCount > 0
      ? ([
          dividerLine(columns),
          { text: label3('void (tidak dihitung)'), bold: true },
          { cols: [`Pembatalan (${input.voidCount} bon)`, rupiah(input.voidAmount ?? 0)] },
        ] as PrintDocLine[])
      : []),
    dividerLine(columns),
    { text: label3('kas akhir'), bold: true },
    { cols: ['Modal Awal', rupiah(input.initialCash)] },
    { cols: ['Saldo Seharusnya', rupiah(input.expectedCash)] },
    { cols: ['Kas Fisik', rupiah(input.finalCash)] },
    {
      cols: ['Selisih', input.difference === 0 ? 'Rp 0 (sesuai)' : rupiah(input.difference)],
      bold: true,
    },
  ];

  if (input.notes) {
    body.push(dividerLine(columns));
    body.push({ text: `Catatan: ${input.notes}` });
  }

  const footer: PrintDocLine[] = [
    dividerLine(columns),
    { text: `Dicetak: ${stampDate(new Date())}`, align: 'center' },
    blankLine(),
  ];

  return { kind: 'zreport', header, body, footer, columns };
}
