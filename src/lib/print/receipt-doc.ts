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
}

export interface SaleReceiptItem {
  name: string;
  /** Variant label ("Susu 250ml") when the SKU sold a flavour/size. */
  variantLabel?: string | null;
  quantity: number;
  unitName?: string | null;
  unitPrice: number;
  subtotal: number;
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

  const body: PrintDocLine[] = [
    { text: `No      : ${trx.invoiceNumber}` },
    { text: `Tanggal : ${stampDate(trx.createdAt)}` },
    { text: `Kasir   : ${trx.cashierName ?? '-'}` },
  ];
  if (trx.branchName) body.push({ text: `Cabang  : ${trx.branchName}` });
  body.push({ text: `Pelanggan: ${trx.customerName || 'Walk-in'}` });
  body.push(dividerLine(columns));

  body.push({ text: 'Item'.padEnd(Math.max(4, columns - 12)) + 'Jml  Harga', bold: true });
  for (const item of trx.items) {
    // "2 Pcs x Rp 5.000" on the right keeps the name readable on 58mm.
    const right = `${qtyLabel(item.quantity)}${item.unitName ? ` ${item.unitName}` : ''} x ${rupiah(item.unitPrice)}`;
    body.push({ cols: [item.name, right] });
    if (item.variantLabel) {
      body.push({ text: `  ${item.variantLabel}` });
    }
    body.push({ text: padPair('', rupiah(item.subtotal), columns), align: 'left' });
  }

  body.push(dividerLine(columns));

  const itemsSum = trx.items.reduce((sum, item) => sum + item.subtotal, 0);
  const discount = Math.max(0, Math.round(itemsSum - trx.total));
  body.push({ cols: ['Subtotal', rupiah(itemsSum)] });
  if (discount > 0) body.push({ cols: ['Diskon', `-${rupiah(discount)}`] });
  body.push({ cols: ['TOTAL', rupiah(trx.total)], bold: true });

  const change = trx.amountPaid - trx.total;
  body.push(dividerLine(columns));
  body.push({ cols: [`Bayar ${paymentLabel(trx.paymentMethod)}`, rupiah(trx.amountPaid)] });
  if (change > 0) body.push({ cols: ['Kembali', rupiah(change)] });

  const footer: PrintDocLine[] = [];
  if (cfg.footer) footer.push({ text: cfg.footer, align: 'center' });
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
