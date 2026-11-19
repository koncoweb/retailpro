import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  Check,
  Info,
  Loader2,
  QrCode,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { readTenantSetting, setTenantSetting } from "@/lib/tenant-settings";
import { useInvalidateTenantSettings } from "@/hooks/use-permissions";
import type { Bank } from "@/components/settings/BankSettings";
import { cn } from "@/lib/utils";
import {
  BUILTIN_CHANNEL_META,
  normalizeChannels,
  PAYMENT_CHANNELS_SETTING_KEY,
  QRIS_MAX_DATA_URL_BYTES,
  QRIS_MAX_SOURCE_BYTES,
  QRIS_OUTPUT_QUALITY,
  QRIS_RESIZE_MAX_PX,
  type FeeSpec,
  type PaymentChannel,
} from "@/lib/payment-channels";

const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

const ACCEPTED_QRIS_TYPES = ["image/png", "image/jpeg", "image/webp"];

interface Draft {
  id: string;
  label: string;
  enabled: boolean;
  feeEditable: boolean;
  feeType: "flat" | "percent";
  feeValue: number;
  bankIds: string[];
}

function feeEditableFor(id: string): boolean {
  return BUILTIN_CHANNEL_META.find((meta) => meta.id === id)?.feeEditable ?? true;
}

function channelToDraft(
  channel: PaymentChannel,
  banks: Bank[]
): Draft {
  const feeEditable = feeEditableFor(channel.id);
  // Soft migration: a transfer channel that never set a fee inherits the legacy
  // per-bank `feePercentage` as the starting value, so upgrading a tenant does
  // not silently drop the fee they were already charging themselves.
  const fallbackPercent =
    channel.id === "transfer" && !channel.fee
      ? banks.find((bank) => Number(bank.feePercentage) > 0)?.feePercentage ?? 0
      : 0;
  return {
    id: channel.id,
    label: channel.label,
    enabled: channel.enabled,
    feeEditable,
    feeType: channel.fee?.type ?? "percent",
    feeValue: channel.fee?.value ?? fallbackPercent,
    bankIds:
      channel.id === "transfer"
        ? channel.bankIds?.length
          ? channel.bankIds
          : banks.map((bank) => bank.id)
        : [],
  };
}

function draftToChannel(draft: Draft): PaymentChannel {
  const channel: PaymentChannel = {
    id: draft.id,
    label: draft.label,
    enabled: draft.enabled,
  };
  if (draft.feeEditable && draft.feeValue > 0) {
    const fee: FeeSpec =
      draft.feeType === "flat"
        ? { type: "flat", value: Math.round(draft.feeValue) }
        : { type: "percent", value: draft.feeValue };
    channel.fee = fee;
  }
  if (draft.id === "transfer") channel.bankIds = draft.bankIds;
  return channel;
}

function channelIcon(id: string) {
  if (id === "cash") return Banknote;
  if (id === "qris") return QrCode;
  return Banknote;
}

/** Downscale + recompress the picked image in the browser before it is posted. */
async function fileToResizedDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = dataUrl;
  });
  const scale = Math.min(1, QRIS_RESIZE_MAX_PX / Math.max(image.width, image.height));
  if (scale >= 1 && dataUrl.startsWith("data:image/webp")) return dataUrl;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/webp", QRIS_OUTPUT_QUALITY);
}

export function PaymentChannelSettings() {
  const invalidate = useInvalidateTenantSettings();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [banks, setBanks] = useState<Bank[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [qrisAvailable, setQrisAvailable] = useState(false);
  const [qrisDataUrl, setQrisDataUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [bankList, rawChannels] = await Promise.all([
          readTenantSetting<Bank[]>("bank", []),
          readTenantSetting<unknown>(PAYMENT_CHANNELS_SETTING_KEY, null),
        ]);
        if (!active) return;
        const banksArr = Array.isArray(bankList) ? bankList : [];
        setBanks(banksArr);
        setDrafts(
          normalizeChannels(rawChannels).map((channel) => channelToDraft(channel, banksArr))
        );
      } catch (error) {
        console.error("Failed to load payment channels:", error);
        toast.error("Gagal memuat pengaturan pembayaran");
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`${apiBase}/api/tenant/qris-image`, { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (!active || !data) return;
        setQrisAvailable(!!data.qrisAvailable);
        setQrisDataUrl(data.dataUrl ?? null);
      })
      .catch((error) => console.error("Failed to load QRIS image:", error));
    return () => {
      active = false;
    };
  }, []);

  const patchDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));

  const toggleBank = (channelId: string, bankId: string, checked: boolean) =>
    setDrafts((prev) =>
      prev.map((draft) => {
        if (draft.id !== channelId) return draft;
        const next = checked
          ? [...new Set([...draft.bankIds, bankId])]
          : draft.bankIds.filter((x) => x !== bankId);
        return { ...draft, bankIds: next };
      })
    );

  const handleSave = async () => {
    setSaving(true);
    try {
      const channels = drafts.map(draftToChannel);
      await setTenantSetting(PAYMENT_CHANNELS_SETTING_KEY, {
        channels,
        updated_at: new Date().toISOString(),
      });
      invalidate();
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      toast.success("Pengaturan pembayaran tersimpan");
    } catch (error) {
      console.error("Failed to save payment channels:", error);
      toast.error("Gagal menyimpan pengaturan pembayaran");
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!ACCEPTED_QRIS_TYPES.includes(file.type)) {
      toast.error("Format gambar harus PNG, JPEG, atau WebP");
      return;
    }
    if (file.size > QRIS_MAX_SOURCE_BYTES) {
      toast.error("Ukuran gambar maksimal 2 MB");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      if (dataUrl.length > QRIS_MAX_DATA_URL_BYTES) {
        toast.error("Gambar terlalu besar untuk disimpan, gunakan resolusi lebih rendah");
        return;
      }
      const response = await fetch(`${apiBase}/api/tenant/qris-image`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail?.message ?? "upload failed");
      }
      setQrisAvailable(true);
      setQrisDataUrl(dataUrl);
      toast.success("Gambar QRIS diperbarui");
    } catch (error) {
      console.error("Failed to upload QRIS image:", error);
      toast.error("Gagal mengunggah gambar QRIS");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const handleDeleteQris = async () => {
    setUploading(true);
    try {
      const response = await fetch(`${apiBase}/api/tenant/qris-image`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error("delete failed");
      setQrisAvailable(false);
      setQrisDataUrl(null);
      toast.success("Gambar QRIS dihapus");
    } catch (error) {
      console.error("Failed to delete QRIS image:", error);
      toast.error("Gagal menghapus gambar QRIS");
    } finally {
      setUploading(false);
    }
  };

  const anyDisabled = useMemo(() => drafts.some((draft) => !draft.enabled), [drafts]);

  if (isLoading) {
    return (
      <div className="bg-card rounded-xl border p-6 flex items-center gap-3 text-sm text-muted-foreground animate-fade-in">
        <Loader2 className="w-4 h-4 animate-spin" />
        Memuat pengaturan pembayaran…
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border p-4 md:p-6 space-y-4 md:space-y-6 animate-fade-in">
      <div className="flex items-center gap-3 pb-4 border-b">
        <div className="p-2.5 rounded-lg bg-primary/10">
          <QrCode className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">Channel Pembayaran</h3>
          <p className="text-sm text-muted-foreground">
            Pilih metode bayar yang aktif dan biaya merchant yang toko tanggung
          </p>
        </div>
        {saving && (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Menyimpan
          </span>
        )}
        {saved && !saving && <span className="text-xs font-medium text-success">Tersimpan</span>}
      </div>

      <div className="space-y-4">
        {drafts.map((draft) => {
          const Icon = channelIcon(draft.id);
          const transferBanks = draft.id === "transfer" ? banks : [];
          return (
            <div key={draft.id} className="rounded-lg border p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-muted/60">
                    <Icon className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="font-medium">{draft.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {BUILTIN_CHANNEL_META.find((meta) => meta.id === draft.id)?.description ??
                        "Channel pembayaran"}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(checked) => patchDraft(draft.id, { enabled: checked })}
                  aria-label={`Aktifkan ${draft.label}`}
                />
              </div>

              {draft.feeEditable && (
                <div className="grid gap-3 sm:grid-cols-[7rem_1fr] sm:items-end pl-1">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Jenis biaya</Label>
                    <Select
                      value={draft.feeType}
                      onValueChange={(value) =>
                        patchDraft(draft.id, { feeType: value === "flat" ? "flat" : "percent" })
                      }
                      disabled={!draft.enabled}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">Persen (%)</SelectItem>
                        <SelectItem value="flat">Flat (Rp)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      Biaya merchant {draft.feeType === "flat" ? "(Rp)" : "(%)"}
                    </Label>
                    <Input
                      type="number"
                      min="0"
                      step={draft.feeType === "flat" ? "100" : "0.1"}
                      className="h-9"
                      value={draft.feeValue || ""}
                      disabled={!draft.enabled}
                      placeholder="0"
                      onChange={(event) =>
                        patchDraft(draft.id, {
                          feeValue: Math.max(0, parseFloat(event.target.value) || 0),
                        })
                      }
                    />
                  </div>
                </div>
              )}

              {draft.id === "transfer" && (
                <div className="space-y-2 pl-1">
                  <Label className="text-xs">Rekening yang diterima</Label>
                  {transferBanks.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Belum ada rekening. Tambahkan di tab Perusahaan → Pengaturan Bank.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                      {transferBanks.map((bank) => (
                        <label
                          key={bank.id}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <Checkbox
                            checked={draft.bankIds.includes(bank.id)}
                            disabled={!draft.enabled}
                            onCheckedChange={(checked) =>
                              toggleBank(draft.id, bank.id, checked === true)
                            }
                          />
                          <span>
                            {bank.name}
                            {bank.accountNumber ? (
                              <span className="text-muted-foreground"> · {bank.accountNumber}</span>
                            ) : null}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {draft.id === "qris" && (
                <div className="space-y-3 pl-1">
                  <Label className="text-xs">Gambar QRIS statis</Label>
                  <div className="flex flex-wrap items-start gap-4">
                    <div
                      className={cn(
                        "h-32 w-32 rounded-lg border flex items-center justify-center overflow-hidden bg-muted/40",
                        !qrisAvailable && "border-dashed"
                      )}
                    >
                      {qrisAvailable && qrisDataUrl ? (
                        <img src={qrisDataUrl} alt="QRIS toko" className="h-full w-full object-contain" />
                      ) : (
                        <span className="text-[11px] text-muted-foreground text-center px-2">
                          Belum ada gambar
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <input
                        ref={fileInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(event) => void handleUpload(event.target.files?.[0])}
                      />
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-2"
                          disabled={uploading}
                          onClick={() => fileInput.current?.click()}
                        >
                          {uploading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Upload className="w-4 h-4" />
                          )}
                          {qrisAvailable ? "Ganti" : "Unggah"}
                        </Button>
                        {qrisAvailable && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="gap-2 text-destructive"
                            disabled={uploading}
                            onClick={() => void handleDeleteQris()}
                          >
                            <Trash2 className="w-4 h-4" />
                            Hapus
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground max-w-xs">
                        Gambar ditampilkan ke pelanggan di kasir dan di toko online. Dimaksimalkan
                        {` ${QRIS_RESIZE_MAX_PX}px, otomatis dikecilkan & dikompres ke WebP.`}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {anyDisabled && (
        <div className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs text-warning">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <p>
            Ada channel yang dinonaktifkan. Kasir hanya menampilkan channel aktif; pesanan toko
            online yang memakai channel nonaktif tidak bisa dibuat sampai diaktifkan lagi.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-1 border-t">
        <p className="text-xs text-muted-foreground">
          Biaya merchant dicatat per transaksi (kolom <span className="font-mono">fee_amount</span>)
          — tidak menambah tagihan pelanggan.
        </p>
        <Button onClick={() => void handleSave()} disabled={saving} className="gap-2 shrink-0">
          {!saving && <Check className="w-4 h-4" />}
          Simpan pengaturan
        </Button>
      </div>
    </div>
  );
}
