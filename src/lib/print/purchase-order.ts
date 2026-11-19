import type { PurchaseOrderDetailData } from "@/components/inventory/PurchaseOrderDetail";
import { PO_STATUS_LABEL, type PurchaseOrderStatus } from "@/lib/procurement";
import { escapeHtml, printHtml } from "@/lib/print/html";

export interface PurchaseOrderPrintLine {
  productName: string;
  sku: string;
  variantName?: string | null;
  quantity: number;
  unitName?: string | null;
  unitCost: number;
  subtotal: number;
}

export interface PurchaseOrderPrintInput {
  poNumber: string;
  status: PurchaseOrderStatus;
  vendorName: string;
  warehouseName: string;
  createdAt: string;
  expectedDate?: string | null;
  paymentTermsDays: number;
  notes?: string | null;
  subtotalAmount: number;
  discountType?: "none" | "percent" | "amount";
  discountValue?: number;
  discountAmount?: number;
  ppnRate: 0 | 11;
  ppnAmount: number;
  totalAmount: number;
  lines: PurchaseOrderPrintLine[];
}

/** Shared projection for list and detail printing; preserves the saved financial snapshot. */
export function purchaseOrderPrintInput(
  order: PurchaseOrderDetailData,
  warehouseName: string
): PurchaseOrderPrintInput {
  return {
    poNumber: order.po_number,
    status: order.status,
    vendorName: order.supplier_name ?? "Tanpa vendor",
    warehouseName,
    createdAt: order.created_at,
    expectedDate: order.expected_date,
    paymentTermsDays: order.payment_terms_days,
    notes: order.notes,
    subtotalAmount: Number(order.subtotal_amount),
    discountType: order.discount_type,
    discountValue: Number(order.discount_value ?? 0),
    discountAmount: Number(order.discount_amount ?? 0),
    ppnRate: order.ppn_rate,
    ppnAmount: Number(order.ppn_amount),
    totalAmount: Number(order.total_amount),
    lines: order.lines.map((line) => ({
      productName: line.product_name,
      sku: line.sku,
      variantName: line.variant_name,
      quantity: Number(line.quantity),
      unitName: line.unit_name,
      unitCost: Number(line.unit_cost),
      subtotal: Number(line.subtotal),
    })),
  };
}

function money(value: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function quantity(value: number): string {
  return Number(Number(value || 0).toFixed(3)).toLocaleString("id-ID");
}

function date(value: string | null | undefined): string {
  if (!value) return "-";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? escapeHtml(value.slice(0, 10))
    : parsed.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
}

/** Pure A4 document builder; all operator/vendor text is escaped before insertion. */
export function renderPurchaseOrderHtml(input: PurchaseOrderPrintInput): string {
  const rows = input.lines
    .map(
      (line, index) => `<tr>
        <td class="center">${index + 1}</td>
        <td><strong>${escapeHtml(line.productName)}</strong><br><small>${escapeHtml(line.sku)}${
          line.variantName ? ` · ${escapeHtml(line.variantName)}` : ""
        }</small></td>
        <td class="number">${quantity(line.quantity)} ${escapeHtml(line.unitName || "")}</td>
        <td class="money">${money(line.unitCost)}</td>
        <td class="money">${money(line.subtotal)}</td>
      </tr>`
    )
    .join("");
  const status = PO_STATUS_LABEL[input.status];

  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.poNumber)} — Purchase Order</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #111827; font: 12px/1.45 Arial, sans-serif; }
  header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111827; padding-bottom: 12px; }
  h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: .04em; }
  .status { display: inline-block; border: 1px solid #374151; padding: 4px 8px; font-weight: 700; text-transform: uppercase; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 28px; margin: 18px 0; }
  .meta div { border-bottom: 1px solid #d1d5db; padding-bottom: 5px; }
  .label { color: #6b7280; display: block; font-size: 10px; text-transform: uppercase; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td { border: 1px solid #9ca3af; padding: 7px; vertical-align: top; }
  th { background: #f3f4f6; text-align: left; }
  th:nth-child(1) { width: 7%; } th:nth-child(2) { width: 43%; }
  th:nth-child(3) { width: 16%; } th:nth-child(4), th:nth-child(5) { width: 17%; }
  .center { text-align: center; } .number, .money { text-align: right; white-space: nowrap; }
  .totals { width: 48%; margin: 14px 0 0 auto; }
  .totals div { display: flex; justify-content: space-between; gap: 20px; padding: 5px 0; }
  .totals .grand { border-top: 2px solid #111827; font-size: 14px; font-weight: 700; }
  .notes { margin-top: 18px; border: 1px solid #d1d5db; padding: 10px; min-height: 48px; white-space: pre-wrap; }
  footer { margin-top: 24px; color: #6b7280; font-size: 10px; text-align: center; }
  small { color: #6b7280; }
</style>
</head>
<body>
<header>
  <div><h1>PURCHASE ORDER</h1><strong>${escapeHtml(input.poNumber)}</strong></div>
  <div class="status">${escapeHtml(status)}</div>
</header>
<section class="meta">
  <div><span class="label">Vendor</span><strong>${escapeHtml(input.vendorName)}</strong></div>
  <div><span class="label">Gudang Tujuan</span><strong>${escapeHtml(input.warehouseName)}</strong></div>
  <div><span class="label">Tanggal PO</span>${date(input.createdAt)}</div>
  <div><span class="label">Tanggal Diharapkan</span>${date(input.expectedDate)}</div>
  <div><span class="label">Termin</span>${Number(input.paymentTermsDays) || 0} hari</div>
  <div><span class="label">Status Pajak</span>${input.ppnRate === 11 ? "PPN 11%" : "Non-PPN"}</div>
</section>
<table>
  <thead><tr><th>No.</th><th>Produk</th><th class="number">Jumlah</th><th class="money">Harga Satuan</th><th class="money">Subtotal</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="5" class="center">Belum ada produk</td></tr>'}</tbody>
</table>
<section class="totals">
  <div><span>Subtotal</span><strong>${money(input.subtotalAmount)}</strong></div>
  ${input.discountAmount ? `<div><span>Diskon${input.discountType === "percent" ? ` (${Number(input.discountValue) || 0}%)` : ""}</span><strong>-${money(input.discountAmount)}</strong></div>
  <div><span>Dasar Pengenaan Pajak</span><strong>${money(input.subtotalAmount - input.discountAmount)}</strong></div>` : ""}
  <div><span>${input.ppnRate === 11 ? "PPN 11%" : "PPN (Non-PPN)"}</span><strong>${money(input.ppnAmount)}</strong></div>
  <div class="grand"><span>Total Pembayaran</span><span>${money(input.totalAmount)}</span></div>
</section>
${input.notes ? `<section class="notes"><span class="label">Catatan</span>${escapeHtml(input.notes)}</section>` : ""}
<footer>Dokumen ini adalah purchase order, bukan faktur pajak.</footer>
</body>
</html>`;
}

export interface PurchaseOrderPrintOptions {
  onError?: (error: Error) => void;
}

/** Print in an isolated hidden iframe so the current PO dialog remains open. */
export function printPurchaseOrder(
  input: PurchaseOrderPrintInput,
  options: PurchaseOrderPrintOptions = {}
): void {
  printHtml(renderPurchaseOrderHtml(input), `Cetak ${input.poNumber}`, options);
}
