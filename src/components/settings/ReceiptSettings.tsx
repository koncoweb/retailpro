import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Printer, Scissors, DoorOpen } from "lucide-react";

export function ReceiptSettings() {
  const [autoPrint, setAutoPrint] = useState(true);
  const [showLogo, setShowLogo] = useState(true);
  const [autoCut, setAutoCut] = useState(true);
  const [openDrawer, setOpenDrawer] = useState(true);
  const [footer, setFooter] = useState("Terima kasih atas kunjungan Anda!");

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
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Cetak Otomatis</p>
            <p className="text-sm text-muted-foreground">Cetak struk setelah transaksi</p>
          </div>
          <Switch checked={autoPrint} onCheckedChange={setAutoPrint} />
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">Tampilkan Logo</p>
            <p className="text-sm text-muted-foreground">Logo pada struk</p>
          </div>
          <Switch checked={showLogo} onCheckedChange={setShowLogo} />
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
          <Switch checked={autoCut} onCheckedChange={setAutoCut} />
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
          <Switch checked={openDrawer} onCheckedChange={setOpenDrawer} />
        </div>

        <div className="space-y-2 pt-2">
          <Label>Footer Struk</Label>
          <Input
            placeholder="Terima kasih atas kunjungan Anda!"
            value={footer}
            onChange={(e) => setFooter(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
