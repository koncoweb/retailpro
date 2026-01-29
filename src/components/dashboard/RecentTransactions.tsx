import { useEffect, useState } from "react";
import { ShoppingCart, CreditCard, Wallet, Banknote } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { query } from "@/lib/db";

interface Transaction {
  id: string;
  invoice_number: string;
  customer_name: string;
  total_amount: number;
  payment_method: string;
  branch_name: string;
  created_at: string;
  items_count: number;
}

const paymentIcons = {
  cash: Banknote,
  card: CreditCard,
  ewallet: Wallet,
  qris: Wallet,
};

const paymentLabels = {
  cash: "Tunai",
  card: "Kartu",
  ewallet: "E-Wallet",
  qris: "QRIS",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export function RecentTransactions() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        const res = await query(`
          SELECT 
            t.id, 
            t.invoice_number,
            t.total_amount, 
            t.payment_method, 
            t.created_at,
            b.name as branch_name,
            c.name as customer_name,
            (SELECT COUNT(*) FROM transaction_items WHERE transaction_id = t.id) as items_count
          FROM transactions t
          LEFT JOIN branches b ON t.branch_id = b.id
          LEFT JOIN customers c ON t.customer_id = c.id
          ORDER BY t.created_at DESC
          LIMIT 5
        `);
        
        setTransactions(res.rows.map((row: any) => ({
          ...row,
          customer_name: row.customer_name || 'Walk-in Customer',
          items_count: parseInt(row.items_count)
        })));
      } catch (error) {
        console.error("Failed to fetch recent transactions:", error);
      }
    };

    fetchTransactions();
  }, []);

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
          const PaymentIcon = paymentIcons[tx.payment_method as keyof typeof paymentIcons] || Banknote;
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
                  <p className="font-medium text-sm">{tx.customer_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {tx.invoice_number} • {tx.items_count} item
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="font-medium text-sm">{formatCurrency(tx.total_amount)}</p>
                <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                   <span>{new Date(tx.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
                   <span>•</span>
                   <span>{tx.branch_name || 'N/A'}</span>
                </div>
              </div>
            </div>
          );
        })}
        {transactions.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Belum ada transaksi hari ini
          </div>
        )}
      </div>
    </div>
  );
}
