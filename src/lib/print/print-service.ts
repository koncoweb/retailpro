/**
 * Print orchestration.
 *
 * One entry point the pages call — `printDocument` — that reads the tenant's
 * printer + receipt preferences, picks a transport, and *never* throws into
 * the business flow: a printer that is off or unplugged must not roll back a
 * committed sale or block a shift close. Callers get a `PrintResult` and turn
 * it into a toast.
 *
 * Transport choice mirrors the settings screen:
 *   - mode `usb` + a live WebUSB handle   → raw ESC/POS over USB
 *   - mode `bluetooth` + a live BLE handle → raw ESC/POS over BLE
 *   - anything else, or a transport that   → the HTML/driver path, which every
 *     fails mid-write                        browser and OS printer supports.
 *
 * The ESC/POS side effects (cut, drawer kick) come from the receipt settings;
 * the drawer only kicks for a cash sale, which the caller tells us.
 */
import { getTenantSession } from '@/lib/tenant-session';
import { readTenantSetting } from '@/lib/tenant-settings';
import { normalizePaperWidth, type PaperWidth, type PrintDoc } from '@/lib/print/document';
import { encodeEscpos } from '@/lib/print/escpos';
import { renderReceiptHtml } from '@/lib/print/html-render';
import {
  downloadPrn,
  hasLiveBle,
  hasLiveUsb,
  printViaBle,
  printViaDriver,
  printViaWebusb,
} from '@/lib/print/print-bridges';

export type PrinterMode = 'driver' | 'usb' | 'bluetooth';
export type PrintVia = 'driver' | 'usb' | 'ble' | 'file';

export interface PrinterConfig {
  mode: PrinterMode;
  paperWidthMm: PaperWidth;
}

/** The receipt-preference slice the ESC/POS encoder + builders need. */
export interface ReceiptPrefs {
  autoPrint: boolean;
  showLogo: boolean;
  autoCut: boolean;
  openDrawer: boolean;
  footer: string;
}

export interface PrintContext {
  receipt: ReceiptPrefs;
  printer: PrinterConfig;
  storeName: string;
}

export interface PrintResult {
  ok: boolean;
  via: PrintVia;
  error?: string;
}

const PRINTER_DEFAULTS: PrinterConfig = { mode: 'driver', paperWidthMm: 80 };
const RECEIPT_DEFAULTS: ReceiptPrefs = {
  autoPrint: true,
  showLogo: true,
  autoCut: true,
  openDrawer: true,
  footer: 'Terima kasih atas kunjungan Anda!',
};

/**
 * Read everything a print needs in one shot. `storeName` comes from the live
 * tenant session (the company the cashier is logged into), so a receipt always
 * carries the right banner without another query.
 */
export async function loadPrintContext(): Promise<PrintContext> {
  const [receipt, printer] = await Promise.all([
    readTenantSetting<ReceiptPrefs>('receipt', RECEIPT_DEFAULTS),
    readTenantSetting<PrinterConfig>('printer', PRINTER_DEFAULTS),
  ]);
  return {
    receipt: { ...RECEIPT_DEFAULTS, ...receipt },
    printer: {
      mode: printer.mode ?? PRINTER_DEFAULTS.mode,
      paperWidthMm: normalizePaperWidth(printer.paperWidthMm),
    },
    storeName: getTenantSession()?.tenantName ?? 'Toko',
  };
}

/**
 * Print a built document. `isCashSale` gates the drawer kick; `forceVia` lets
 * the settings test button exercise a specific transport.
 */
export async function printDocument(
  doc: PrintDoc,
  ctx: PrintContext,
  options: { isCashSale?: boolean; forceVia?: PrintVia } = {}
): Promise<PrintResult> {
  const widthMm = ctx.printer.paperWidthMm;
  const wantUsb = options.forceVia ? options.forceVia === 'usb' : ctx.printer.mode === 'usb';
  const wantBle = options.forceVia
    ? options.forceVia === 'ble'
    : ctx.printer.mode === 'bluetooth';

  // ESC/POS transports only when a device is actually connected; otherwise the
  // driver path is the honest fallback (and always available).
  if (wantUsb && hasLiveUsb()) {
    const bytes = encodeEscpos(doc, {
      autoCut: ctx.receipt.autoCut,
      openCashDrawer: ctx.receipt.openDrawer && options.isCashSale === true,
    });
    try {
      await printViaWebusb(bytes);
      return { ok: true, via: 'usb' };
    } catch (error) {
      return {
        ok: false,
        via: 'usb',
        error: error instanceof Error ? error.message : 'Cetak USB gagal',
      };
    }
  }

  if (wantBle && hasLiveBle()) {
    const bytes = encodeEscpos(doc, {
      autoCut: ctx.receipt.autoCut,
      // No drawer kick over BLE — these printers have no kick port.
      openCashDrawer: false,
    });
    try {
      await printViaBle(bytes);
      return { ok: true, via: 'ble' };
    } catch (error) {
      return {
        ok: false,
        via: 'ble',
        error: error instanceof Error ? error.message : 'Cetak Bluetooth gagal',
      };
    }
  }

  // Driver path. If the caller explicitly asked for a raw transport but no
  // device is connected, hand back the `.prn` instead of silently printing on
  // the wrong printer — the user chose USB/BLE for a reason.
  if (options.forceVia === 'usb' || options.forceVia === 'file') {
    const bytes = encodeEscpos(doc, { autoCut: ctx.receipt.autoCut });
    downloadPrn(bytes, `${doc.kind}-${Date.now()}`);
    return { ok: true, via: 'file' };
  }

  try {
    await printViaDriver(renderReceiptHtml(doc, widthMm));
    return { ok: true, via: 'driver' };
  } catch (error) {
    return {
      ok: false,
      via: 'driver',
      error: error instanceof Error ? error.message : 'Cetak gagal',
    };
  }
}

/** Human label for the toast so the cashier knows which printer answered. */
export function viaLabel(via: PrintVia): string {
  switch (via) {
    case 'usb':
      return 'USB';
    case 'ble':
      return 'Bluetooth';
    case 'file':
      return 'file .prn';
    default:
      return 'printer sistem';
  }
}
