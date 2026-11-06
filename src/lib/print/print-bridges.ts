/**
 * Print transports.
 *
 * Four ways to get bytes/paper out of the browser, each for a slice of the
 * Indonesian thermal-printer market:
 *
 *   - `printViaDriver`   — the universal path. Renders the receipt as HTML in
 *                           a hidden iframe and calls `contentWindow.print()`.
 *                           Works for USB/kabel, network, and Bluetooth
 *                           printers already bonded as an OS printer, on every
 *                           browser (Chrome/Edge/Firefox, Windows + Android).
 *   - `printViaWebusb`   — raw ESC/POS over USB, Chrome/Edge desktop only. One
 *                           `requestDevice` gesture, then every later sale
 *                           auto-prints without a dialog.
 *   - `printViaBle`      — raw ESC/POS over Bluetooth LE, the Android-Chrome
 *                           path for ZJ-58/80, Sinjuxson, XPrinter BT units.
 *   - `downloadPrn`      — escape hatch: hand the user the ESC/POS bytes as a
 *                           `.prn` to drop on a spooled queue. Works where no
 *                           browser API can reach the printer (Windows
 *                           Bluetooth with no driver, Safari, etc).
 *
 * The WebUSB/Web Bluetooth objects are not in the standard TS DOM lib, so the
 * shapes we touch are declared structurally here rather than pulled in as a
 * global ambient dependency — narrower, and it cannot clash with a future lib
 * update.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// Minimal structural typings for the two browser APIs we reach for.
// ---------------------------------------------------------------------------

interface UsbEndpointLike {
  endpointNumber: number;
  direction: string;
  type: string;
}
interface UsbInterfaceAlternateLike {
  endpoints: UsbEndpointLike[];
  interfaceClass?: number;
  interfaceProtocol?: number;
  interfaceNumber?: number;
}
interface UsbInterfaceLike {
  interfaceNumber: number;
  alternates: UsbInterfaceAlternateLike[];
}
interface UsbDeviceLike {
  opened: boolean;
  configurationInterfaces?: UsbInterfaceLike[];
  open(): Promise<void>;
  close(): void;
  selectConfiguration(): Promise<void>;
  claimInterface(endpoint: number): Promise<void>;
  releaseInterface(endpoint: number): Promise<void>;
  transferOut(endpoint: number, data: ArrayBufferView | ArrayBuffer): Promise<{ bytesWritten: number }>;
}
interface UsbDeviceFilterLike {
  vendorId?: number;
  productId?: number;
  classCode?: number;
}
interface NavigatorUsbLike {
  getDevices(): Promise<UsbDeviceLike[]>;
  requestDevice(options: { filters: UsbDeviceFilterLike[] }): Promise<UsbDeviceLike>;
}

interface BluetoothGattCharacteristicLike {
  properties?: { writeWithoutResponse?: boolean; write?: boolean };
  writeValue(value: ArrayBufferView | ArrayBuffer): Promise<void>;
  startNotifications?(): Promise<unknown>;
}
interface BluetoothGattServiceLike {
  uuid?: string;
  getCharacteristic(uuid: string): Promise<BluetoothGattCharacteristicLike | undefined>;
}
interface BluetoothDeviceLike {
  gatt?: {
    connected: boolean;
    connect(): Promise<BluetoothGattServiceLike[] | unknown>;
    getPrimaryService(uuid: string): Promise<BluetoothGattServiceLike>;
  };
}
interface NavigatorBluetoothLike {
  requestDevice(options: unknown): Promise<BluetoothDeviceLike>;
}

function usbApi(): NavigatorUsbLike | null {
  const nav = navigator as any;
  return nav.usb ?? null;
}
function bluetoothApi(): NavigatorBluetoothLike | null {
  const nav = navigator as any;
  return nav.bluetooth ?? null;
}

/**
 * Vendor/product ids seen on the ESC/POS-class printers sold in Indonesia.
 * The broad `classCode: 7` (printer) filter is what actually catches most;
 * these pairs are for units that misreport their class.
 */
const USB_PRINTER_FILTERS: UsbDeviceFilterLike[] = [
  { classCode: 7 }, // printer class — the reliable catch-all
  { vendorId: 0x0483 }, // STMicro/Virtual COM (many generic + XPrinter)
  { vendorId: 0x1244 }, // Dware/Epson-adjacent
  { vendorId: 0x28e9 }, // POS-5805 / generic thermal
];

/** ESC/POS Bluetooth services in the wild, most-common first. */
const BLE_ESCPOS_SERVICES = [
  '49572fc4-3a42-11df-9517-000650401414', // the "china printer" UUID
  '0000fff1-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
];
const BLE_ESCPOS_CHARACTERISTICS = [
  '49572fc8-3a42-11df-9517-000650401414',
  '0000fff2-0000-1000-8000-00805f9b34fb',
  '0000ffe1-0000-1000-8000-00805f9b34fb',
];

// Connection state lives in module memory: a device picked once per session
// should not force a fresh `requestDevice` gesture on every subsequent sale.
let liveUsb: UsbDeviceLike | null = null;
let liveUsbEndpoint: number | null = null;
let liveBle: BluetoothGattCharacteristicLike | null = null;

export function hasLiveUsb(): boolean {
  return liveUsb !== null;
}
export function hasLiveBle(): boolean {
  return liveBle !== null;
}

/**
 * Ask the browser for a USB printer and open its OUT endpoint. Must be called
 * from inside a user gesture (a click in Settings). Returns false when WebUSB
 * is unavailable so the caller can fall back to the driver path.
 */
export async function connectUsb(): Promise<boolean> {
  const usb = usbApi();
  if (!usb) return false;
  try {
    // Reuse a device the OS already remembers as "allowed for this origin".
    const known = await usb.getDevices();
    const device = known[0] ?? (await usb.requestDevice({ filters: USB_PRINTER_FILTERS }));
    if (!device.opened) await device.open();
    await device.selectConfiguration();

    const iface = device.configurationInterfaces?.find((i) =>
      i.alternates.some((a) => a.endpoints.some((e) => e.direction === 'Out'))
    );
    const alt = iface?.alternates.find((a) => a.endpoints.some((e) => e.direction === 'Out'));
    const out = alt?.endpoints.find((e) => e.direction === 'Out');
    if (!iface || !alt || !out) {
      device.close();
      return false;
    }
    await device.claimInterface(iface.interfaceNumber);
    liveUsb = device;
    liveUsbEndpoint = out.endpointNumber;
    return true;
  } catch {
    return false;
  }
}

/** BLE pairing handshake, also gesture-only. */
export async function connectBle(): Promise<boolean> {
  const bt = bluetoothApi();
  if (!bt) return false;
  try {
    const device = await bt.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_ESCPOS_SERVICES,
    });
    const services = (await device.gatt?.connect()) as BluetoothGattServiceLike[] | undefined;
    // Some stacks return the service list, others need an explicit lookup.
    for (const uuid of BLE_ESCPOS_SERVICES) {
      let service: BluetoothGattServiceLike | undefined = services?.find?.((s) => s.uuid === uuid);
      if (!service) {
        try {
          service = await device.gatt?.getPrimaryService(uuid);
        } catch {
          service = undefined;
        }
      }
      if (!service) continue;
      for (const charUuid of BLE_ESCPOS_CHARACTERISTICS) {
        const ch = await service.getCharacteristic(charUuid).catch(() => undefined);
        if (ch?.properties?.writeWithoutResponse || ch?.properties?.write) {
          liveBle = ch;
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/** Split writes so a single transfer never exceeds the endpoint MTU. */
function chunk(bytes: Uint8Array, size: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
}

export async function printViaWebusb(bytes: Uint8Array): Promise<void> {
  if (!liveUsb || liveUsbEndpoint === null) throw new Error('Printer USB belum tersambung');
  for (const part of chunk(bytes, 4096)) {
    await liveUsb.transferOut(liveUsbEndpoint, part);
  }
}

export async function printViaBle(bytes: Uint8Array): Promise<void> {
  if (!liveBle) throw new Error('Printer Bluetooth belum tersambung');
  // BLE writes are capped near the MTU (~20–180 bytes); stay well under so a
  // long receipt never overflows a single characteristic write.
  for (const part of chunk(bytes, 100)) {
    await liveBle.writeValue(part);
  }
}

/**
 * Render the pre-built HTML in a hidden iframe and drive the native print
 * dialog. This is the fallback that always exists, so it never throws for a
 * missing API — only if the browser blocks the iframe.
 */
export function printViaDriver(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const cleanup = () => {
      // Give the print spool a beat to grab the document before removal.
      setTimeout(() => iframe.remove(), 1000);
    };

    iframe.onload = () => {
      try {
        const win = iframe.contentWindow;
        if (!win) throw new Error('Iframe print window tidak tersedia');
        // Let the layout settle (fonts, @page) before opening the dialog.
        setTimeout(() => {
          try {
            win.focus();
            win.print();
            cleanup();
            resolve();
          } catch (err) {
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }, 120);
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    iframe.onerror = () => {
      cleanup();
      reject(new Error('Gagal memuat dokumen cetak'));
    };

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    if (!doc) {
      iframe.remove();
      reject(new Error('Browser memblokir frame cetak'));
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
  });
}

/** Escape hatch: hand the ESC/POS bytes to the user as a `.prn` file. */
export function downloadPrn(bytes: Uint8Array, filename: string): void {
  // Copy into an ArrayBuffer-backed view: BlobPart wants ArrayBufferView<ArrayBuffer>,
  // and a plain `Uint8Array` is typed `Uint8Array<ArrayBufferLike>` (may be SharedArrayBuffer).
  const blob = new Blob([new Uint8Array(bytes)], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.prn') ? filename : `${filename}.prn`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
