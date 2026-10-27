import { useEffect, useState } from "react";
import { Boxes, Check, Info, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { readTenantSetting, setTenantSetting } from "@/lib/tenant-settings";
import {
  DEFAULT_STOCK_ISSUE_METHOD,
  normalizeStockIssueMethod,
  STOCK_ISSUE_METHODS,
  STOCK_ISSUE_METHOD_FIELD,
  STOCK_ISSUE_SETTING_KEY,
  stockIssueMethodMeta,
  type StockIssueMethod,
} from "@/lib/stock-issue";

/**
 * Tenant policy for the question "which batch leaves first?".
 *
 * The choice is stored in `tenants.settings.inventory.stock_issue_method` and
 * read by every stock-out path (POS, stock reduction, opname, transfer
 * approval), so it is saved on click rather than behind a page-level button —
 * a till in another tab must not keep selling with the old order.
 */
export function InventorySettings() {
  const [method, setMethod] = useState<StockIssueMethod>(DEFAULT_STOCK_ISSUE_METHOD);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    readTenantSetting<Record<string, unknown> | null>(STOCK_ISSUE_SETTING_KEY, null)
      .then((stored) => {
        if (!active) return;
        setMethod(normalizeStockIssueMethod(stored?.[STOCK_ISSUE_METHOD_FIELD]));
      })
      .catch((error) => console.error("Failed to load inventory settings:", error))
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSelect = async (next: StockIssueMethod) => {
    if (next === method || isSaving) return;

    const previous = method;
    setMethod(next);
    setIsSaving(true);
    try {
      const stored = await readTenantSetting<Record<string, unknown> | null>(
        STOCK_ISSUE_SETTING_KEY,
        null
      );
      await setTenantSetting(STOCK_ISSUE_SETTING_KEY, {
        ...(stored ?? {}),
        [STOCK_ISSUE_METHOD_FIELD]: next,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      toast.success(`Metode pengeluaran stok: ${stockIssueMethodMeta(next).label}`);
    } catch (error) {
      console.error("Failed to save stock issue method:", error);
      setMethod(previous);
      toast.error("Gagal menyimpan metode pengeluaran stok");
    } finally {
      setIsSaving(false);
    }
  };

  const active = stockIssueMethodMeta(method);

  return (
    <div className="bg-card rounded-xl border p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
      <div className="flex items-center gap-3 pb-4 border-b">
        <div className="p-2.5 rounded-lg bg-primary/10">
          <Boxes className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">Metode Pengeluaran Stok</h3>
          <p className="text-sm text-muted-foreground">
            Urutan batch yang diambil sistem saat barang keluar dari gudang
          </p>
        </div>
        {(isSaving || isLoading) && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {isLoading ? "Memuat" : "Menyimpan"}
          </span>
        )}
        {saved && !isSaving && (
          <span className="text-xs font-medium text-success">Tersimpan</span>
        )}
      </div>

      <div role="radiogroup" aria-label="Metode pengeluaran stok" className="grid gap-3">
        {STOCK_ISSUE_METHODS.map((option) => {
          const isActive = option.value === method;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              disabled={isLoading || isSaving}
              onClick={() => handleSelect(option.value)}
              className={cn(
                "w-full text-left rounded-lg border p-4 transition-colors",
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/40 hover:bg-muted/40",
                (isLoading || isSaving) && "opacity-70"
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                    isActive ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                  )}
                >
                  {isActive && <Check className="w-3 h-3" />}
                </span>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{option.label}</p>
                    {option.value === DEFAULT_STOCK_ISSUE_METHOD && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Bawaan
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{option.description}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">Cocok untuk:</span>{" "}
                    {option.bestFor}
                  </p>
                  <p className="text-xs text-warning">
                    <span className="font-medium">Perhatian:</span> {option.caveat}
                  </p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        <Info className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <p>
            Berlaku untuk semua pengeluaran stok: transaksi kasir, pengurangan stok dari form
            produk, selisih stok opname, dan persetujuan transfer antar gudang.
          </p>
          <p>
            Metode aktif <span className="font-medium text-foreground">{active.label}</span>.
            Perubahan hanya memengaruhi pengeluaran stok berikutnya — transaksi yang sudah
            tercatat tidak dihitung ulang, jadi HPP lama tetap apa adanya.
          </p>
        </div>
      </div>
    </div>
  );
}
