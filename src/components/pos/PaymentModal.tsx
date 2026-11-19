import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Banknote,
  Landmark,
  QrCode,
  Check,
  Info,
  Loader2,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import type { Bank } from "@/components/settings/BankSettings";
import {
  computeMerchantFee,
  feeLabel,
  paymentMethodForChannel,
  type PaymentChannel,
} from "@/lib/payment-channels";

export interface PaymentDetails {
  /** Value written to `transactions.payment_method` (channel id). */
  method: string;
  received?: number;
  change?: number;
  bank?: string;
  /** Merchant fee for this sale (rupiah). Never added to what the customer pays. */
  fee?: number;
  /** Compact description of the fee taken at sale time. */
  feeLabel?: string | null;
}

interface PaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  /** Resolves once the sale is committed; `false` means it was refused. */
  onPaymentComplete: (
    paymentMethod: string,
    paymentDetails: PaymentDetails
  ) => Promise<boolean | void> | boolean | void;
  /** Normalized channels; only the enabled ones are rendered as tabs. */
  channels: PaymentChannel[];
  /** Full bank list from settings; the transfer tab filters to `bankIds`. */
  banks: Bank[];
  /** Static QRIS image (data URL) or null when the owner has not uploaded one. */
  qrisDataUrl?: string | null;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

const CHANNEL_ICONS: Record<string, typeof Banknote> = {
  cash: Banknote,
  transfer: Landmark,
  qris: QrCode,
};

function channelIcon(id: string) {
  return CHANNEL_ICONS[id] ?? Banknote;
}

/** Fallback so the till can still close a cash sale if settings failed to load. */
const CASH_ONLY: PaymentChannel[] = [{ id: "cash", label: "Tunai", enabled: true }];

export function PaymentModal({
  open,
  onOpenChange,
  total,
  onPaymentComplete,
  channels,
  banks,
  qrisDataUrl,
}: PaymentModalProps) {
  const list = useMemo(() => {
    const enabled = channels.filter((channel) => channel.enabled);
    return enabled.length ? enabled : CASH_ONLY;
  }, [channels]);

  const firstId = list[0]?.id ?? "cash";
  const [paymentMethod, setPaymentMethod] = useState(firstId);
  const [cashAmount, setCashAmount] = useState("");
  const [selectedBank, setSelectedBank] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [zoom, setZoom] = useState(false);

  // When the dialog opens (or the channel set changes underneath it), land on a
  // tab that actually exists rather than a stale one from a previous sale.
  useEffect(() => {
    if (!open) return;
    setPaymentMethod((prev) => (list.some((channel) => channel.id === prev) ? prev : firstId));
  }, [open, firstId, list]);

  const transferChannel = list.find((channel) => channel.id === "transfer") ?? null;
  const qrisChannel = list.find((channel) => channel.id === "qris") ?? null;

  const transferBanks = useMemo(() => {
    const ids = transferChannel?.bankIds;
    if (ids && ids.length) return banks.filter((bank) => ids.includes(bank.id));
    return banks;
  }, [transferChannel, banks]);

  const cashReceived = parseFloat(cashAmount) || 0;
  const change = cashReceived - total;

  const activeChannel = list.find((channel) => channel.id === paymentMethod);
  const fee = activeChannel ? computeMerchantFee(activeChannel, total) : 0;
  const feeText = activeChannel && fee > 0 ? feeLabel(activeChannel) : null;

  const handlePayment = async () => {
    const method = paymentMethodForChannel(paymentMethod);
    const details: PaymentDetails = { method };

    if (paymentMethod === "cash") {
      if (cashReceived < total) {
        toast.error("Uang yang diterima kurang dari total");
        return;
      }
      details.received = cashReceived;
      details.change = change;
    } else if (paymentMethod === "transfer") {
      if (transferBanks.length > 0 && !selectedBank) {
        toast.error("Pilih rekening tujuan terlebih dahulu");
        return;
      }
      const chosen = transferBanks.find((bank) => bank.id === selectedBank);
      if (chosen) details.bank = chosen.name;
    }

    if (fee > 0) {
      details.fee = fee;
      details.feeLabel = feeText;
    }

    setIsSubmitting(true);
    try {
      // The sale only happened once the caller's write has committed. Announcing
      // success before that reported sales that were never stored.
      const outcome = await onPaymentComplete(method, details);
      if (outcome === false) return; // the caller has already said why
      toast.success("Pembayaran berhasil!");
      onOpenChange(false);
      resetForm();
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setCashAmount("");
    setSelectedBank("");
    setZoom(false);
  };

  const quickCashAmounts = [50000, 100000, 150000, 200000, 500000];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Pembayaran</DialogTitle>
        </DialogHeader>

        <div className="p-4 bg-primary/10 rounded-lg mb-4">
          <p className="text-sm text-muted-foreground">Total Pembayaran</p>
          <p className="text-3xl font-bold text-primary">{formatCurrency(total)}</p>
        </div>

        <Tabs value={paymentMethod} onValueChange={setPaymentMethod}>
          <TabsList
            className="w-full grid"
            style={{ gridTemplateColumns: `repeat(${list.length}, minmax(0, 1fr))` }}
          >
            {list.map((channel) => {
              const Icon = channelIcon(channel.id);
              return (
                <TabsTrigger key={channel.id} value={channel.id} className="gap-2">
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{channel.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {list.map((channel) =>
            channel.id === "cash" ? (
              <TabsContent key="cash" value="cash" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label>Uang Diterima</Label>
                  <Input
                    type="number"
                    placeholder="Masukkan nominal"
                    value={cashAmount}
                    onChange={(e) => setCashAmount(e.target.value)}
                    className="text-lg"
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {quickCashAmounts.map((amount) => (
                    <Button
                      key={amount}
                      variant="outline"
                      size="sm"
                      onClick={() => setCashAmount(amount.toString())}
                    >
                      {formatCurrency(amount)}
                    </Button>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCashAmount(total.toString())}
                  >
                    Uang Pas
                  </Button>
                </div>
                {cashReceived >= total && (
                  <div className="p-4 bg-success/10 rounded-lg">
                    <p className="text-sm text-muted-foreground">Kembalian</p>
                    <p className="text-2xl font-bold text-success">{formatCurrency(change)}</p>
                  </div>
                )}
              </TabsContent>
            ) : channel.id === "transfer" ? (
              <TabsContent key="transfer" value="transfer" className="space-y-4 mt-4">
                {transferBanks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Belum ada rekening yang diaktifkan. Atur di Pengaturan → Pembayaran.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <Label>Rekening Tujuan</Label>
                    <Select value={selectedBank} onValueChange={setSelectedBank}>
                      <SelectTrigger>
                        <SelectValue placeholder="Pilih rekening" />
                      </SelectTrigger>
                      <SelectContent>
                        {transferBanks.map((bank) => (
                          <SelectItem key={bank.id} value={bank.id}>
                            {bank.name}
                            {bank.accountNumber ? ` · ${bank.accountNumber}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedBank && (
                      <p className="text-xs text-muted-foreground">
                        {transferBanks.find((bank) => bank.id === selectedBank)?.accountName}
                      </p>
                    )}
                  </div>
                )}
                <MerchantFeeNote fee={fee} label={feeText} />
              </TabsContent>
            ) : channel.id === "qris" ? (
              <TabsContent key="qris" value="qris" className="space-y-4 mt-4">
                {qrisDataUrl ? (
                  <div className="flex flex-col items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setZoom(true)}
                      className="relative rounded-lg border bg-white p-2 hover:opacity-90"
                      aria-label="Perbesar gambar QRIS"
                    >
                      <img
                        src={qrisDataUrl}
                        alt="QRIS toko"
                        className="h-48 w-48 object-contain"
                      />
                      <span className="absolute right-1 top-1 rounded bg-black/60 p-1 text-white">
                        <ZoomIn className="w-4 h-4" />
                      </span>
                    </button>
                    <p className="text-sm text-muted-foreground">
                      Silakan pindai QRIS ini untuk membayar
                    </p>
                  </div>
                ) : (
                  <div className="p-6 bg-muted/50 rounded-lg flex flex-col items-center text-center">
                    <QrCode className="w-24 h-24 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Gambar QRIS belum diunggah owner
                    </p>
                  </div>
                )}
                <MerchantFeeNote fee={fee} label={feeText} />
              </TabsContent>
            ) : null
          )}
        </Tabs>

        <div className="flex gap-2 pt-4">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Batal
          </Button>
          <Button className="flex-1 gap-2" onClick={handlePayment} disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {isSubmitting ? "Memproses…" : "Bayar"}
          </Button>
        </div>
      </DialogContent>

      {qrisChannel && qrisDataUrl && (
        <Dialog open={zoom} onOpenChange={setZoom}>
          <DialogContent className="max-w-[92vw] sm:max-w-[560px]">
            <DialogHeader>
              <DialogTitle>QRIS Pembayaran</DialogTitle>
            </DialogHeader>
            <img
              src={qrisDataUrl}
              alt="QRIS toko ukuran penuh"
              className="w-full h-auto rounded-lg bg-white p-2"
            />
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}

/**
 * Merchant-cost reminder. The fee is what the store pays the gateway — the
 * customer's bill is unchanged, so the note says "dicatat, tidak menambah
 * tagihan" to stop a cashier from adding it to what they collect.
 */
function MerchantFeeNote({ fee, label }: { fee: number; label: string | null }) {
  if (fee <= 0) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
      <Info className="w-4 h-4 mt-0.5 shrink-0" />
      <p>
        Biaya merchant: <span className="font-medium text-foreground">{formatCurrency(fee)}</span>
        {label ? ` (${label})` : ""} — dicatat, tidak menambah tagihan pelanggan.
      </p>
    </div>
  );
}
