import { escapeHtml, printHtml, type HtmlPrintOptions } from "@/lib/print/html";

export interface DeliveryNoteLine {
  product_name: string;
  sku: string;
  variant_name?: string | null;
  unit_name: string | null;
  quantity_sent: number;
  conversion_factor: number;
}
export interface DeliveryNoteInput {
  requestNumber: string;
  transferNumber?: string | null;
  dispatchedAt: string | null;
  sourceName: string;
  destinationName: string;
  outletName: string;
  dispatchedBy?: string | null;
  receivedBy?: string | null;
  notes?: string | null;
  lines: DeliveryNoteLine[];
}

/** Only dispatched execution quantities belong on a delivery note, never approvals. */
export function renderDeliveryNoteHtml(input: DeliveryNoteInput): string {
  if (!input.dispatchedAt) throw new Error("Pesanan belum dikirim");
  const lines = input.lines.filter((line) => Number(line.quantity_sent) > 0);
  if (!lines.length) throw new Error("Tidak ada barang yang dikirim");
  const numeric = (value: number) => Number(value).toLocaleString("id-ID", { maximumFractionDigits: 3 });
  const rows = lines.map((line, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(line.product_name)}<br><small>${escapeHtml(line.sku)}${line.variant_name ? ` · ${escapeHtml(line.variant_name)}` : ""}</small></td><td class="number">${numeric(line.quantity_sent)}</td><td>${escapeHtml(line.unit_name || "Pcs")}</td><td class="number">${numeric(line.quantity_sent * (Number(line.conversion_factor) || 1))}</td></tr>`).join("");
  const total = lines.reduce((sum, line) => sum + Number(line.quantity_sent) * (Number(line.conversion_factor) || 1), 0);
  return `<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Surat Jalan ${escapeHtml(input.transferNumber || input.requestNumber)}</title><style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; } body { font: 12px/1.5 Arial, sans-serif; color: #111; margin: 0; }
  header { border-bottom: 2px solid #111; padding-bottom: 12px; } h1 { font-size: 24px; margin: 0; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; margin: 18px 0; }
  table { width: 100%; border-collapse: collapse; } th, td { padding: 8px; border: 1px solid #999; text-align: left; overflow-wrap: anywhere; }
  thead { display: table-header-group; } tr { break-inside: avoid; } .number { text-align: right; }
  .notes { white-space: pre-wrap; border: 1px solid #ccc; padding: 10px; margin-top: 18px; }
  .signatures { display: flex; justify-content: space-between; gap: 24px; margin-top: 30px; break-inside: avoid; }
  .signatures div { text-align: center; flex: 1; } .signature { margin-top: 65px; border-top: 1px solid #111; padding-top: 4px; }
  small { color: #555; } footer { margin-top: 20px; font-size: 10px; }
  </style></head><body><header><h1>SURAT JALAN</h1><strong>${escapeHtml(input.transferNumber || input.requestNumber)}</strong></header>
  <section class="meta"><div>Pesanan: <strong>${escapeHtml(input.requestNumber)}</strong></div><div>Tanggal kirim: ${escapeHtml(input.dispatchedAt.slice(0, 10))}</div>
  <div>Dari: ${escapeHtml(input.sourceName)}</div><div>Ke: ${escapeHtml(input.destinationName)}</div><div>Outlet: ${escapeHtml(input.outletName)}</div></section>
  <table><thead><tr><th>No.</th><th>Produk / SKU / Varian</th><th>Jumlah</th><th>Satuan</th><th>Unit dasar</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><td colspan="4">Total unit dasar</td><td class="number">${numeric(total)}</td></tr></tfoot></table>
  ${input.notes ? `<section class="notes">Catatan: ${escapeHtml(input.notes)}</section>` : ""}
  <section class="signatures"><div>Pengirim<div class="signature">${escapeHtml(input.dispatchedBy || "Nama / tanda tangan")}</div></div><div>Pengemudi<div class="signature">Nama / tanda tangan</div></div><div>Penerima<div class="signature">${escapeHtml(input.receivedBy || "Nama / tanda tangan")}</div></div></section>
  <footer>Jumlah berdasarkan barang yang benar-benar dikirim. Dokumen ini bukan faktur.</footer></body></html>`;
}

export function printDeliveryNote(input: DeliveryNoteInput, options: HtmlPrintOptions = {}): void {
  printHtml(renderDeliveryNoteHtml(input), `Cetak Surat Jalan ${input.requestNumber}`, options);
}
