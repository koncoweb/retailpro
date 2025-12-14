import { ShoppingCart, CreditCard, Wallet, Banknote } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const transactions = [
  {
    id: "TRX-2024001",
    customer: "Walk-in Customer",
    amount: 450000,
    paymentMethod: "cash",
    branch: "Jakarta",
    time: "10:32",
    items: 5,
  },
  {
    id: "TRX-2024002",
    customer: "Budi Santoso",
    amount: 1250000,
    paymentMethod: "card",
    branch: "Surabaya",
    time: "10:28",
    items: 12,
  },
  {
    id: "TRX-2024003",
    customer: "Walk-in Customer",
    amount: 85000,
    paymentMethod: "ewallet",
    branch: "Bandung",
    time: "10:25",
    items: 2,
  },
  {
    id: "TRX-2024004",
    customer: "Maria Chen",
    amount: 780000,
    paymentMethod: "card",
    branch: "Jakarta",
    time: "10:18",
    items: 8,
  },
  {
    id: "TRX-2024005",
    customer: "Walk-in Customer",
    amount: 320000,
    paymentMethod: "cash",
    branch: "Medan",
    time: "10:12",
    items: 4,
  },
];

const paymentIcons = {
  cash: Banknote,
  card: CreditCard,
  ewallet: Wallet,
};

const paymentLabels = {
  cash: "Tunai",
  card: "Kartu",
  ewallet: "E-Wallet",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export function RecentTransactions() {
  return (
    <div className="bg-card rounded-xl border p-5 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold">Transaksi Terbaru</h3>
          <p className="text-sm text-muted-foreground">5 transaksi terakhir</p>
        </div>
        <ShoppingCart className="w-5 h-5 text-muted-foreground" />
      </div>
      <div className="space-y-3">
        {transactions.map((tx, index) => {
          const PaymentIcon = paymentIcons[tx.paymentMethod as keyof typeof paymentIcons];
          return (
            <div
              key={tx.id}
              className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors animate-slide-up"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <PaymentIcon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="font-medium text-sm">{tx.customer}</p>
                  <p className="text-xs text-muted-foreground">
                    {tx.id} • {tx.items} item
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-semibold text-sm">{formatCurrency(tx.amount)}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className="text-xs">
                    {tx.branch}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{tx.time}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
