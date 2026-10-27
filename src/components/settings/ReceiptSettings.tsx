import { useEffect, useRef, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Printer, Scissors, DoorOpen } from "lucide-react";
import { readTenantSetting, setTenantSetting } from "@/lib/tenant-settings";

export interface ReceiptConfig {
  autoPrint: boolean;
  showLogo: boolean;
  autoCut: boolean;
  openDrawer: boolean;
  footer: string;
}

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
  const [saved, setSaved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    readTenantSetting<ReceiptConfig>("receipt", DEFAULTS)
      .then((stored) => {
        if (active) setConfig({ ...DEFAULTS, ...stored });
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
    </div>
  );
}
