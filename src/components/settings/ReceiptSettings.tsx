import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Printer, Scissors, DoorOpen, Usb, Bluetooth, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { readTenantSetting, setTenantSetting } from "@/lib/tenant-settings";
import {
  type PrinterConfig,
  type PrinterMode,
  loadPrintContext,
  printDocument,
  viaLabel,
} from "@/lib/print/print-service";
import { buildTestPage } from "@/lib/print/receipt-doc";
import { columnsForPaper, PAPER_WIDTHS, type PaperWidth } from "@/lib/print/document";
import {
  connectBle,
  connectUsb,
  hasLiveBle,
  hasLiveUsb,
} from "@/lib/print/print-bridges";

export interface ReceiptConfig {
  autoPrint: boolean;
  showLogo: boolean;
  autoCut: boolean;
  openDrawer: boolean;
  footer: string;
}

const PRINTER_DEFAULTS: PrinterConfig = { mode: "driver", paperWidthMm: 80 };

const DEFAULTS: ReceiptConfig = {
  autoPrint: true,
  showLogo: true,
  autoCut: true,
  openDrawer: true,
  footer: "Terima kasih atas kunjungan Anda!",
};

/**
 * Receipt preferences are persisted in `tenants.settings.receipt`.
 *
 * Before this the switches were plain `useState`, so every reload silently
 * reverted to the defaults and a tenant could not actually configure its
 * printer. Writes are debounced because the footer is a text field.
 */
export function ReceiptSettings() {
  const [config, setConfig] = useState<ReceiptConfig>(DEFAULTS);
  const [printer, setPrinter] = useState<PrinterConfig>(PRINTER_DEFAULTS);
  const [saved, setSaved] = useState(false);
  // Reflects the live WebUSB/BLE handles so the connect button can say
  // "Terhubung" without a round trip; refreshed on every mode change/click.
  const [usbReady, setUsbReady] = useState(false);
  const [bleReady, setBleReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      readTenantSetting<ReceiptConfig>("receipt", DEFAULTS),
      readTenantSetting<PrinterConfig>("printer", PRINTER_DEFAULTS),
    ])
      .then(([storedReceipt, storedPrinter]) => {
        if (!active) return;
        setConfig({ ...DEFAULTS, ...storedReceipt });
        setPrinter({ ...PRINTER_DEFAULTS, ...storedPrinter });
        setUsbReady(hasLiveUsb());
        setBleReady(hasLiveBle());
      })
      .catch((error) => console.error("Failed to load receipt settings:", error));
    return () => {
      active = false;
    };
  }, []);

  const update = (patch: Partial<ReceiptConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setTenantSetting("receipt", next)
        .then(() => {
          setSaved(true);
          if (savedTimer.current) clearTimeout(savedTimer.current);
          savedTimer.current = setTimeout(() => setSaved(false), 1500);
        })
        .catch((error) => console.error("Failed to save receipt settings:", error));
    }, 400);
  };

  /**
   * Printer config writes are immediate (no debounce): a mode/paper change is
   * a discrete choice the cashier expects to take effect on the very next
   * print, not something typed character-by-character like the footer.
   */
  const updatePrinter = (patch: Partial<PrinterConfig>) => {
    const next = { ...printer, ...patch };
    setPrinter(next);
    setTenantSetting("printer", next)
      .then(() => {
        setSaved(true);
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 1500);
      })
      .catch((error) => console.error("Failed to save printer settings:", error));
  };

  const handleConnect = async () => {
    if (printer.mode === "driver") {
      toast.info("Mode driver memakai printer yang sudah terpasang di sistem — tidak perlu sambungkan terpisah.");
      return;
    }
    setConnecting(true);
    try {
      // requestDevice only works inside a user gesture, and this click is that
      // gesture; the two transports are separate APIs so pick by mode.
      const ok = printer.mode === "usb" ? await connectUsb() : await connectBle();
      setUsbReady(hasLiveUsb());
      setBleReady(hasLiveBle());
      if (ok) toast.success("Printer tersambung.");
      else
        toast.error(
          "Gagal menyambungkan. Pastikan browser mendukung (Chrome/Edge), printer menyala, dan mode pesawat mati."
        );
    } finally {
      setConnecting(false);
    }
  };

  const handleTestPrint = async () => {
    try {
      const ctx = await loadPrintContext();
      // Merge the live switches so the test page cuts like a real receipt.
      ctx.receipt = { ...ctx.receipt, ...config };
      ctx.printer = { ...ctx.printer, ...printer };
      const doc = buildTestPage({
        storeName: ctx.storeName,
        paperWidthMm: printer.paperWidthMm,
        showLogo: config.showLogo,
        footer: config.footer,
      });
      // "driver" prints via the OS dialog; the raw modes print (or hand back a
      // .prn when no device is connected) via their transport.
      const forceVia = printer.mode === "usb" ? "usb" : printer.mode === "bluetooth" ? "ble" : undefined;
      const result = await printDocument(doc, ctx, { forceVia });
      if (result.ok) toast.success(`Tes terkirim ke printer (${viaLabel(result.via)}).`);
      else toast.error(result.error ?? "Cetak tes gagal.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Cetak tes gagal.");
    }
  };

  return (
    <div className="bg-card rounded-xl border p-6 space-y-6 animate-fade-in">
      <div className="flex items-center gap-3 pb-4 border-b">
        <div className="p-2.5 rounded-lg bg-warning/10">
          <Printer className="w-5 h-5 text-warning" />
        </div>
        <div>
          <h3 className="font-semibold">Pengaturan Struk</h3>
          <p className="text-sm text-muted-foreground">Konfigurasi printer dan struk</p>
        </div>
        {saved && (
          <span className="ml-auto text-xs text-success">Tersimpan</span>
        )}
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Cetak Otomatis</p>
            <p className="text-sm text-muted-foreground">Cetak struk setelah transaksi</p>
          </div>
          <Switch
            checked={config.autoPrint}
            onCheckedChange={(checked) => update({ autoPrint: checked })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Tampilkan Logo</p>
            <p className="text-sm text-muted-foreground">Logo pada struk</p>
          </div>
          <Switch
            checked={config.showLogo}
            onCheckedChange={(checked) => update({ showLogo: checked })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-info/10">
              <Scissors className="w-4 h-4 text-info" />
            </div>
            <div>
              <p className="font-medium">Auto Cut</p>
              <p className="text-sm text-muted-foreground">Potong kertas otomatis setelah cetak</p>
            </div>
          </div>
          <Switch
            checked={config.autoCut}
            onCheckedChange={(checked) => update({ autoCut: checked })}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-success/10">
              <DoorOpen className="w-4 h-4 text-success" />
            </div>
            <div>
              <p className="font-medium">Open Cash Drawer</p>
              <p className="text-sm text-muted-foreground">Buka laci kas setelah transaksi tunai</p>
            </div>
          </div>
          <Switch
            checked={config.openDrawer}
            onCheckedChange={(checked) => update({ openDrawer: checked })}
          />
        </div>

        <div className="space-y-2 pt-2">
          <Label>Footer Struk</Label>
          <Input
            placeholder="Terima kasih atas kunjungan Anda!"
            value={config.footer}
            onChange={(e) => update({ footer: e.target.value })}
          />
        </div>
      </div>

      {/* Printer & Koneksi: the transport choice that decides how a struk
          actually leaves the browser. Grouped as its own block because it is a
          hardware decision, separate from the paper-content switches above. */}
      <div className="space-y-4 pt-2 border-t">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-warning/10">
            <Printer className="w-4 h-4 text-warning" />
          </div>
          <div>
            <p className="font-medium">Printer &amp; Koneksi</p>
            <p className="text-sm text-muted-foreground">
              Pilih cara cetak. Driver = printer USB/kabel/jaringan yang sudah
              dipasang di sistem.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Mode Printer</Label>
            <Select
              value={printer.mode}
              onValueChange={(value) => {
                updatePrinter({ mode: value as PrinterMode });
                setUsbReady(hasLiveUsb());
                setBleReady(hasLiveBle());
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih mode" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="driver">Cetak via Driver (USB / Jaringan / Bluetooth pair)</SelectItem>
                <SelectItem value="usb">USB Thermal (WebUSB — Chrome/Edge)</SelectItem>
                <SelectItem value="bluetooth">Bluetooth Thermal (Web Bluetooth — Android)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Lebar Kertas</Label>
            <Select
              value={String(printer.paperWidthMm)}
              onValueChange={(value) => updatePrinter({ paperWidthMm: Number(value) as PaperWidth })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Lebar kertas" />
              </SelectTrigger>
              <SelectContent>
                {[...PAPER_WIDTHS].reverse().map((mm) => (
                  <SelectItem key={mm} value={String(mm)}>
                    {mm} mm ({columnsForPaper(mm)} kolom)
                    {mm === 80 ? " — prioritas" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              58/60 mm paling umum untuk printer Bluetooth mini; 80 mm untuk printer meja/jaringan.
              Pilih yang sesuai gulungan kertas yang dipakai.
            </p>
          </div>
        </div>

        {printer.mode !== "driver" && (
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="gap-2" onClick={handleConnect} disabled={connecting}>
              {connecting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : printer.mode === "usb" ? (
                <Usb className="w-4 h-4" />
              ) : (
                <Bluetooth className="w-4 h-4" />
              )}
              Sambungkan Printer
            </Button>
            <span className="text-sm text-muted-foreground">
              {(printer.mode === "usb" ? usbReady : bleReady) ? (
                <span className="text-success">Terhubung</span>
              ) : (
                "Belum tersambung — cetak otomatis akan memakai printer sistem."
              )}
            </span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="gap-2" onClick={handleTestPrint}>
            <Printer className="w-4 h-4" />
            Cetak Tes
          </Button>
          <span className="text-xs text-muted-foreground">
            Mengecek printer, kertas, dan karakter Rp sekaligus.
          </span>
        </div>
      </div>
    </div>
  );
}
