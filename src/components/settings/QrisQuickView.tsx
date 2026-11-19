import { useState } from "react";
import { Loader2, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

/**
 * Small "Lihat QRIS" affordance for the vendor/partner payment dialogs.
 *
 * The image is the tenant's own static QRIS (the one shown to shoppers at the
 * till and in the online store), uploaded in Settings → Pembayaran. It is lazy:
 * the fetch only happens the first time a cashier opens it, so the payment form
 * does not pay for an image it may never show.
 */
export function QrisQuickView() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checked, setChecked] = useState(false);
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  const handleOpen = async () => {
    setOpen(true);
    if (checked || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/tenant/qris-image`, { credentials: "include" });
      const data = res.ok ? await res.json() : null;
      setDataUrl(data?.qrisAvailable ? (data.dataUrl ?? null) : null);
    } catch (error) {
      console.error("Failed to load QRIS image:", error);
      setDataUrl(null);
    } finally {
      setLoading(false);
      setChecked(true);
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs"
        onClick={handleOpen}
      >
        <QrCode className="w-3.5 h-3.5" />
        Lihat QRIS
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[90vw] sm:max-w-[360px]">
          <DialogHeader>
            <DialogTitle>QRIS Toko</DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="flex h-48 items-center justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : dataUrl ? (
            <img
              src={dataUrl}
              alt="QRIS toko"
              className="h-auto w-full rounded-lg bg-white p-2"
            />
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Gambar QRIS belum diunggah owner di Pengaturan → Pembayaran.
            </p>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
