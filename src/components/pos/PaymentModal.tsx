import { useState } from "react";
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
  CreditCard,
  Wallet,
  Check,
  Loader2,
  QrCode,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";

export interface PaymentDetails {
  method: string;
  received?: number;
  change?: number;
  bank?: string;
  cardType?: "debit" | "credit";
  wallet?: string;
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
  banks: { id: string; name: string; type: string }[];
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

const eWallets = [
  { id: "qris", name: "QRIS", icon: QrCode },
  { id: "ovo", name: "OVO", icon: Smartphone },
  { id: "gopay", name: "GoPay", icon: Smartphone },
  { id: "dana", name: "DANA", icon: Smartphone },
  { id: "shopeepay", name: "ShopeePay", icon: Smartphone },
];

export function PaymentModal({
  open,
  onOpenChange,
  total,
  onPaymentComplete,
  banks,
}: PaymentModalProps) {
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [cashAmount, setCashAmount] = useState("");
  const [selectedBank, setSelectedBank] = useState("");
  const [cardType, setCardType] = useState<"debit" | "credit">("debit");
  const [selectedEWallet, setSelectedEWallet] = useState("qris");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const cashReceived = parseFloat(cashAmount) || 0;
  const change = cashReceived - total;

  const handlePayment = async () => {
    let paymentDetails: PaymentDetails = { method: paymentMethod };

    if (paymentMethod === "cash") {
      if (cashReceived < total) {
        toast.error("Uang yang diterima kurang dari total");
        return;
      }
      paymentDetails = {
        ...paymentDetails,
        received: cashReceived,
        change: change,
      };
    } else if (paymentMethod === "card") {
      if (!selectedBank) {
        toast.error("Pilih bank terlebih dahulu");
        return;
      }
      paymentDetails = {
        ...paymentDetails,
        bank: selectedBank,
        cardType: cardType,
      };
    } else if (paymentMethod === "ewallet") {
      paymentDetails = {
        ...paymentDetails,
        wallet: selectedEWallet,
      };
    }

    setIsSubmitting(true);
    try {
      // The sale only happened once the caller's write has committed. Announcing
      // success before that reported sales that were never stored.
      const outcome = await onPaymentComplete(paymentMethod, paymentDetails);
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
    setCardType("debit");
    setSelectedEWallet("qris");
  };

  const quickCashAmounts = [50000, 100000, 150000, 200000, 500000];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Pembayaran</DialogTitle>
        </DialogHeader>

        <div className="p-4 bg-primary/10 rounded-lg mb-4">
          <p className="text-sm text-muted-foreground">Total Pembayaran</p>
          <p className="text-3xl font-bold text-primary">{formatCurrency(total)}</p>
        </div>

        <Tabs value={paymentMethod} onValueChange={setPaymentMethod}>
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="cash" className="gap-2">
              <Banknote className="w-4 h-4" />
              <span className="hidden sm:inline">Tunai</span>
            </TabsTrigger>
            <TabsTrigger value="card" className="gap-2">
              <CreditCard className="w-4 h-4" />
              <span className="hidden sm:inline">Kartu</span>
            </TabsTrigger>
            <TabsTrigger value="ewallet" className="gap-2">
              <Wallet className="w-4 h-4" />
              <span className="hidden sm:inline">E-Wallet</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="cash" className="space-y-4 mt-4">
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
                <p className="text-2xl font-bold text-success">
                  {formatCurrency(change)}
                </p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="card" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Jenis Kartu</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant={cardType === "debit" ? "default" : "outline"}
                  onClick={() => setCardType("debit")}
                  className="gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  Debit
                </Button>
                <Button
                  variant={cardType === "credit" ? "default" : "outline"}
                  onClick={() => setCardType("credit")}
                  className="gap-2"
                >
                  <CreditCard className="w-4 h-4" />
                  Kredit
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Pilih Bank</Label>
              <Select value={selectedBank} onValueChange={setSelectedBank}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih bank" />
                </SelectTrigger>
                <SelectContent>
                  {banks.length > 0 ? (
                    banks.map((bank) => (
                      <SelectItem key={bank.id} value={bank.id}>
                        {bank.name}
                      </SelectItem>
                    ))
                  ) : (
                    <>
                      <SelectItem value="bca">BCA</SelectItem>
                      <SelectItem value="mandiri">Mandiri</SelectItem>
                      <SelectItem value="bni">BNI</SelectItem>
                      <SelectItem value="bri">BRI</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="ewallet" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label>Pilih E-Wallet</Label>
              <div className="grid grid-cols-2 gap-2">
                {eWallets.map((wallet) => (
                  <Button
                    key={wallet.id}
                    variant={selectedEWallet === wallet.id ? "default" : "outline"}
                    onClick={() => setSelectedEWallet(wallet.id)}
                    className="gap-2 justify-start"
                  >
                    <wallet.icon className="w-4 h-4" />
                    {wallet.name}
                  </Button>
                ))}
              </div>
            </div>
            {selectedEWallet === "qris" && (
              <div className="p-6 bg-muted/50 rounded-lg flex flex-col items-center">
                <QrCode className="w-32 h-32 text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Scan QRIS untuk membayar</p>
              </div>
            )}
          </TabsContent>
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
    </Dialog>
  );
}
