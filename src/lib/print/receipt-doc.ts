/**
 * Customer receipt (struk nota) builder.
 *
 * Maps a saved transaction — the row plus its items, exactly as they exist in
 * `transactions` / `transaction_items` — into the print document model. Both
 * the auto-print after checkout and the reprint from Riwayat Transaksi go
 * through here, so the paper a customer gets at 21:15 matches the one printed
 * at the till.
 *
 * The discount *percentage* is never stored per transaction, but the rupiah
 * amount is recoverable: `SUM(items.subtotal) - total_amount` is what the
 * discount was worth (0 when none). That is why the builders take persisted
 * rows rather than cart state.
 */
import {
  blankLine,
  dividerLine,
  padPair,
  rupiah,
  stampDate,
  columnsForPaper,
  type PaperWidth,
  type PrintDoc,
  type PrintDocLine,
} from '@/lib/print/document';

/** The transaction row (plus joined display names) a receipt prints from. */
export interface SaleReceiptInput {
  invoiceNumber: string;
  createdAt: string;
  total: number;
  /** What the customer actually handed over; equals total for non-cash. */
  amountPaid: number;
  paymentMethod: string;
  cashierName?: string | null;
  branchName?: string | null;
  customerName?: string | null;
  items: SaleReceiptItem[];
  /** `'void'` stamps the whole note as cancelled (009). */
  status?: 'completed' | 'void';
  /** Reason the bon was voided; shown under the banner. */
  voidReason?: string | null;
}

export interface SaleReceiptItem {
  name: string;
  /** Variant label ("Susu 250ml") when the SKU sold a flavour/size. */
  variantLabel?: string | null;
  quantity: number;
  unitName?: string | null;
  unitPrice: number;
  subtotal: number;
  /** This line was voided: it prints struck-through and excluded from totals. */
  voided?: boolean;
  /** Why the line was voided; printed under the [VOID] marker when present. */
  voidReason?: string | null;
}

export interface ReceiptConfig {
  storeName: string;
  storeAddress?: string | null;
  footer?: string;
  paperWidthMm: PaperWidth;
  showLogo: boolean;
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Tunai',
  transfer: 'Transfer Bank',
  card: 'Kartu',
  debit: 'Kartu Debit',
  credit: 'Kartu Kredit',
  ewallet: 'E-Wallet',
  qris: 'QRIS',
};

export function paymentLabel(method: string): string {
  return PAYMENT_LABELS[method] ?? method;
}

/** `1.5` keeps its decimals, whole counts print without a trailing `.0`. */
function qtyLabel(quantity: number): string {
  return String(quantity);
}

/**
 * Build the 48/32-column struk. `columns` comes from the paper width so a
 * 58mm tenant gets the same layout squeezed to 32 chars, not a wrapped mess.
 */
export function buildSaleReceipt(
  trx: SaleReceiptInput,
  cfg: ReceiptConfig
): PrintDoc {
  const columns = columnsForPaper(cfg.paperWidthMm);

  const header: PrintDocLine[] = [
    { text: cfg.storeName, size: 2, align: 'center', bold: true },
  ];
  if (cfg.storeAddress) header.push({ text: cfg.storeAddress, align: 'center' });
  header.push(dividerLine(columns));

  const isVoid = trx.status === 'void';

  const body: PrintDocLine[] = [];
  if (isVoid) {
    // Whole-bon void: stamp it before anything else so a glance says "cancelled".
    body.push({ text: 'TRANSAKSI DIBATALKAN', size: 2, align: 'center', bold: true });
    if (trx.voidReason) body.push({ text: `Alasan: ${trx.voidReason}`, align: 'center' });
    body.push(dividerLine(columns));
  }
  body.push({ text: `No      : ${trx.invoiceNumber}` });
  body.push({ text: `Tanggal : ${stampDate(trx.createdAt)}` });
  body.push({ text: `Kasir   : ${trx.cashierName ?? '-'}` });
  if (trx.branchName) body.push({ text: `Cabang  : ${trx.branchName}` });
  body.push({ text: `Pelanggan: ${trx.customerName || 'Walk-in'}` });
  body.push(dividerLine(columns));

  body.push({ text: 'Item'.padEnd(Math.max(4, columns - 12)) + 'Jml  Harga', bold: true });
  for (const item of trx.items) {
    const struck = !!item.voided;
    // "2 Pcs x Rp 5.000" on the right keeps the name readable on 58mm.
    const right = `${qtyLabel(item.quantity)}${item.unitName ? ` ${item.unitName}` : ''} x ${rupiah(item.unitPrice)}`;
    body.push({ cols: [item.name, right], strikethrough: struck });
    if (item.variantLabel) {
      body.push({ text: `  ${item.variantLabel}`, strikethrough: struck });
    }
    body.push({ text: padPair('', rupiah(item.subtotal), columns), align: 'left', strikethrough: struck });
    // Explicit text marker so a printer that ignores `ESC G` still shows the void.
    if (struck) {
      body.push({ text: '   [VOID]', align: 'left' });
      if (item.voidReason) body.push({ text: `   Alasan: ${item.voidReason}`, align: 'left' });
    }
  }

  body.push(dividerLine(columns));

  // A partial (per-item) void counts only the live lines, so the bon's discount
  // stays intact through the reduced total. A whole-bon void keeps the original
  // lines (all struck) — showing what was cancelled, not a bare zero.
  const itemsSum = isVoid
    ? trx.items.reduce((sum, item) => sum + item.subtotal, 0)
    : trx.items.reduce((sum, item) => (item.voided ? sum : sum + item.subtotal), 0);
  const discount = Math.max(0, Math.round(itemsSum - trx.total));
  body.push({ cols: ['Subtotal', rupiah(itemsSum)], strikethrough: isVoid });
  if (discount > 0) body.push({ cols: ['Diskon', `-${rupiah(discount)}`], strikethrough: isVoid });
  body.push({ cols: ['TOTAL', rupiah(trx.total)], bold: true, strikethrough: isVoid });

  const change = trx.amountPaid - trx.total;
  body.push(dividerLine(columns));
  body.push({ cols: [`Bayar ${paymentLabel(trx.paymentMethod)}`, rupiah(trx.amountPaid)], strikethrough: isVoid });
  if (change > 0) body.push({ cols: ['Kembali', rupiah(change)], strikethrough: isVoid });

  const footer: PrintDocLine[] = [];
  if (isVoid) footer.push({ text: '--- DIBATALKAN / VOID ---', align: 'center', bold: true });
  else if (cfg.footer) footer.push({ text: cfg.footer, align: 'center' });
  else footer.push({ text: '*** TERIMA KASIH ***', align: 'center' });
  footer.push({ text: '* * * * * * * * * * * *', align: 'center' });
  footer.push(blankLine());

  return { kind: 'sale', header, body, footer, columns };
}

/** A minimal page the settings screen sends to verify printer + paper. */
export function buildTestPage(cfg: ReceiptConfig): PrintDoc {
  const columns = columnsForPaper(cfg.paperWidthMm);
  return {
    kind: 'test',
    header: [
      { text: 'TES CETAK', size: 2, align: 'center', bold: true },
      dividerLine(columns),
    ],
    body: [
      { text: cfg.storeName, align: 'center' },
      blankLine(),
      { cols: ['Rupiah', rupiah(12500)] },
      { cols: ['Karakter', 'abc ABC 123 !@#'] },
      dividerLine(columns),
      { text: 'Lebar kertas teruji:', align: 'center' },
      { text: 'X'.repeat(columns), align: 'center' },
      dividerLine(columns),
    ],
    footer: [{ text: 'Jika baris X muat satu kolom, kertas OK.', align: 'center' }, blankLine()],
    columns,
  };
}
