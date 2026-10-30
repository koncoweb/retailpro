import { useState, useEffect } from "react";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { query, runTransaction } from "@/lib/db";
import { logAudit, logAuditTx } from "@/lib/audit";
import { useAuth } from "@/hooks/use-auth";
import { format } from "date-fns";
import { id as idLocale } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, DollarSign, Calendar, User, Download } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VENDOR_PAYMENT_METHODS, isoDate } from "@/lib/vendor";

interface Transaction {
  id: string;
  invoice_number: string;
  customer_name: string;
  total_amount: number;
  amount_paid: number;
  created_at: string;
  due_date: string | null;
}

interface Expense {
  id: string;
  description: string;
  category: string;
  amount: number;
  amount_paid: number;
  date: string;
  due_date: string | null;
  supplier_name: string | null;
  supplier_id: string | null;
  /** Set when the bill was booked by a goods receipt. */
  purchase_order_id: string | null;
}

interface Supplier {
  id: string;
  name: string;
}

export default function ApAr() {
  const { user } = useAuth();
  const [receivables, setReceivables] = useState<Transaction[]>([]);
  const [payables, setPayables] = useState<Expense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // States for Payables (AP)
  const [isAddApOpen, setIsAddApOpen] = useState(false);
  const [newAp, setNewAp] = useState({
    description: "",
    amount: "",
    due_date: format(new Date(), "yyyy-MM-dd"),
    supplier_id: "",
    category: "Hutang Usaha"
  });

  // States for Payment
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<{
    id: string;
    type: 'ar' | 'ap';
    current_paid: number;
    total: number;
    /** AP only: vendor whose ledger records the payment. */
    supplier_id?: string | null;
    /** AP only: order the bill was received against, carried onto the payment. */
    purchase_order_id?: string | null;
    description?: string;
  } | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("transfer");
  const [paymentReference, setPaymentReference] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const handleExport = () => {
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: Piutang (AR)
      const arData = receivables.map(item => ({
        "Invoice": item.invoice_number,
        "Pelanggan": item.customer_name || "Umum",
        "Tgl Transaksi": format(new Date(item.created_at), "dd/MM/yyyy"),
        "Jatuh Tempo": item.due_date ? format(new Date(item.due_date), "dd/MM/yyyy") : "-",
        "Total": item.total_amount,
        "Terbayar": item.amount_paid,
        "Sisa": item.total_amount - item.amount_paid
      }));
      const wsAr = XLSX.utils.json_to_sheet(arData);
      // Auto-width for AR
      const wscolsAr = [
          {wch: 15}, {wch: 20}, {wch: 15}, {wch: 15}, {wch: 15}, {wch: 15}, {wch: 15}
      ];
      wsAr['!cols'] = wscolsAr;
      XLSX.utils.book_append_sheet(wb, wsAr, "Piutang (AR)");

      // Sheet 2: Hutang (AP)
      const apData = payables.map(item => ({
        "Keterangan": item.description,
        "Kategori": item.category,
        "Supplier": item.supplier_name || "-",
        "Tgl Catat": format(new Date(item.date), "dd/MM/yyyy"),
        "Jatuh Tempo": item.due_date ? format(new Date(item.due_date), "dd/MM/yyyy") : "-",
        "Total": item.amount,
        "Terbayar": item.amount_paid,
        "Sisa": item.amount - item.amount_paid
      }));
      const wsAp = XLSX.utils.json_to_sheet(apData);
      // Auto-width for AP
      const wscolsAp = [
          {wch: 30}, {wch: 20}, {wch: 20}, {wch: 15}, {wch: 15}, {wch: 15}, {wch: 15}, {wch: 15}
      ];
      wsAp['!cols'] = wscolsAp;
      XLSX.utils.book_append_sheet(wb, wsAp, "Hutang (AP)");

      XLSX.writeFile(wb, `Hutang_Piutang_${format(new Date(), "yyyy-MM-dd")}.xlsx`);
      toast.success("Berhasil export data Hutang & Piutang");
    } catch (error) {
      console.error("Export failed:", error);
      toast.error("Gagal export data");
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch AR (Piutang)
      const arRes = await query(`
        SELECT t.id, t.invoice_number, t.total_amount, t.amount_paid, t.created_at, t.due_date, c.name as customer_name
        FROM transactions t
        LEFT JOIN customers c ON t.customer_id = c.id
        WHERE t.total_amount > t.amount_paid
        ORDER BY t.created_at DESC
      `);
      setReceivables((arRes.rows as unknown as Transaction[]).map((row) => ({
        ...row,
        total_amount: Number(row.total_amount),
        amount_paid: Number(row.amount_paid)
      })));

      // Fetch AP (Hutang)
      const apRes = await query(`
        SELECT e.id, e.description, e.category, e.amount, e.amount_paid, e.date, e.due_date,
               s.name as supplier_name, e.supplier_id, e.purchase_order_id
        FROM expenses e
        LEFT JOIN suppliers s ON e.supplier_id = s.id
        WHERE e.amount > e.amount_paid
        ORDER BY e.date DESC
      `);
      setPayables((apRes.rows as unknown as Expense[]).map((row) => ({
        ...row,
        amount: Number(row.amount),
        amount_paid: Number(row.amount_paid)
      })));

      // Fetch Suppliers
      const supRes = await query("SELECT id, name FROM suppliers ORDER BY name ASC");
      setSuppliers((supRes.rows as unknown as Supplier[]).filter((s) => s.id && s.id !== ""));

    } catch (error) {
      console.error("Failed to fetch AP/AR data:", error);
      toast.error("Gagal memuat data Hutang/Piutang");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddAp = async () => {
    if (!newAp.description || !newAp.amount || !newAp.due_date) {
      toast.error("Mohon lengkapi data wajib");
      return;
    }

    try {
      const inserted = await query<{ id: string }>(`
        INSERT INTO expenses (description, amount, date, due_date, supplier_id, category, status, amount_paid)
        VALUES ($1, $2, date('now'), $3, $4, $5, 'unpaid', 0)
        RETURNING id
      `, [
        newAp.description,
        parseFloat(newAp.amount),
        newAp.due_date,
        newAp.supplier_id || null,
        newAp.category
      ]);

      // Recording a payable creates a liability; it must be traceable.
      await logAudit({
        action: "create_expense",
        entity: "expenses",
        entityId: inserted.rows[0]?.id,
        userId: user?.id,
        details: {
          kind: "payable",
          category: newAp.category,
          amount: parseFloat(newAp.amount),
          due_date: newAp.due_date,
          description: newAp.description,
          supplier_id: newAp.supplier_id || null,
        },
      });

      toast.success("Hutang berhasil dicatat");
      setIsAddApOpen(false);
      setNewAp({
        description: "",
        amount: "",
        due_date: format(new Date(), "yyyy-MM-dd"),
        supplier_id: "",
        category: "Hutang Usaha"
      });
      fetchData();
    } catch (error) {
      console.error("Failed to add AP:", error);
      toast.error("Gagal mencatat hutang");
    }
  };

  const handleOpenPayment = (item: Expense | Transaction, type: 'ar' | 'ap') => {
    // Both shapes carry `amount_paid`; only AP has a vendor to credit.
    const isAp = type === 'ap';
    const ap = isAp ? (item as Expense) : null;
    const total = isAp ? (item as Expense).amount : (item as Transaction).total_amount;
    setSelectedItem({
      id: item.id,
      type,
      current_paid: item.amount_paid,
      total,
      supplier_id: ap?.supplier_id ?? null,
      purchase_order_id: ap?.purchase_order_id ?? null,
      description: ap?.description,
    });
    setPaymentAmount((total - item.amount_paid).toString());
    setPaymentMethod(isAp ? "transfer" : "cash");
    setPaymentReference("");
    setPaymentOpen(true);
  };

  const handleSubmitPayment = async () => {
    if (!selectedItem || !paymentAmount) return;
    
    const amount = parseFloat(paymentAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Jumlah pembayaran tidak valid");
      return;
    }

    const newTotalPaid = selectedItem.current_paid + amount;
    if (newTotalPaid > selectedItem.total) {
      toast.error("Pembayaran melebihi sisa tagihan");
      return;
    }

    try {
      if (selectedItem.type === 'ar') {
        await query(`
          UPDATE transactions 
          SET amount_paid = $1, 
              status = CASE WHEN $1 >= total_amount THEN 'paid' ELSE status END
          WHERE id = $2
        `, [newTotalPaid, selectedItem.id]);

        await logAudit({
          action: "create_payment",
          entity: "transactions",
          entityId: selectedItem.id,
          details: { kind: "receivable_payment", amount },
          userId: user?.id,
        });
      } else {
        // Vendor payment: the payable balance and the payment ledger move
        // together, so the vendor screen and the finance screen cannot disagree.
        await runTransaction(async (tx) => {
          const updated = await tx.query(
            `UPDATE expenses
             SET amount_paid = amount_paid + $1,
                 status = CASE WHEN amount_paid + $1 >= amount THEN 'paid' ELSE 'unpaid' END
             WHERE id = $2 AND amount_paid + $1 <= amount`,
            [amount, selectedItem.id]
          );
          if (updated.rowCount !== 1) {
            throw new Error("Tagihan berubah, muat ulang data terlebih dahulu");
          }

          if (selectedItem.supplier_id) {
            await tx.query(
              `INSERT INTO vendor_payments
                 (vendor_id, expense_id, purchase_order_id, amount, payment_date, method,
                  reference_number, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                selectedItem.supplier_id,
                selectedItem.id,
                selectedItem.purchase_order_id ?? null,
                amount,
                isoDate(),
                paymentMethod,
                paymentReference.trim() || null,
                user?.id ?? null,
              ]
            );
          }

          await logAuditTx(tx, {
            action: "create_payment",
            entity: "expenses",
            entityId: selectedItem.id,
            details: {
              kind: "payable_payment",
              amount,
              method: paymentMethod,
              reference: paymentReference.trim() || null,
              supplier_id: selectedItem.supplier_id ?? null,
              description: selectedItem.description,
            },
            userId: user?.id,
          });
        });
      }

      toast.success("Pembayaran berhasil dicatat");
      setPaymentOpen(false);
      fetchData();
    } catch (error) {
      console.error("Failed to process payment:", error);
      toast.error(error instanceof Error ? error.message : "Gagal memproses pembayaran");
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(amount);
  };

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Hutang & Piutang</h1>
            <p className="text-muted-foreground">Manajemen tagihan supplier dan piutang pelanggan</p>
          </div>
          <Button variant="outline" className="gap-2" onClick={handleExport}>
            <Download className="h-4 w-4" /> Export Excel
          </Button>
        </div>

        <Tabs defaultValue="ar" className="space-y-4">
          <TabsList>
            <TabsTrigger value="ar">Piutang (AR)</TabsTrigger>
            <TabsTrigger value="ap">Hutang (AP)</TabsTrigger>
          </TabsList>
          
          <TabsContent value="ar">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Daftar Piutang Pelanggan</CardTitle>
                <div className="flex gap-2">
                   {/* AR usually comes from POS, but could add manual AR button here if needed */}
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Pelanggan</TableHead>
                      <TableHead>Tgl Transaksi</TableHead>
                      <TableHead>Jatuh Tempo</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Terbayar</TableHead>
                      <TableHead className="text-right">Sisa</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receivables.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          Tidak ada data piutang
                        </TableCell>
                      </TableRow>
                    ) : (
                      receivables.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">{item.invoice_number}</TableCell>
                          <TableCell>{item.customer_name || "Umum"}</TableCell>
                          <TableCell>{format(new Date(item.created_at), "dd MMM yyyy", { locale: idLocale })}</TableCell>
                          <TableCell>
                            {item.due_date ? format(new Date(item.due_date), "dd MMM yyyy", { locale: idLocale }) : "-"}
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(item.total_amount)}</TableCell>
                          <TableCell className="text-right text-green-600">{formatCurrency(item.amount_paid)}</TableCell>
                          <TableCell className="text-right text-red-600 font-bold">
                            {formatCurrency(item.total_amount - item.amount_paid)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" onClick={() => handleOpenPayment(item, 'ar')}>
                              Bayar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="ap">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Daftar Hutang Supplier</CardTitle>
                <Dialog open={isAddApOpen} onOpenChange={setIsAddApOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Plus className="mr-2 h-4 w-4" /> Catat Hutang
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Catat Hutang Baru</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="desc">Keterangan</Label>
                        <Input
                          id="desc"
                          placeholder="Contoh: Pembelian Stok Batch #123"
                          value={newAp.description}
                          onChange={(e) => setNewAp({ ...newAp, description: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="amount">Jumlah (Rp)</Label>
                        <Input
                          id="amount"
                          type="number"
                          placeholder="0"
                          value={newAp.amount}
                          onChange={(e) => setNewAp({ ...newAp, amount: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="due_date">Jatuh Tempo</Label>
                        <Input
                          id="due_date"
                          type="date"
                          value={newAp.due_date}
                          onChange={(e) => setNewAp({ ...newAp, due_date: e.target.value })}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label htmlFor="supplier">Supplier</Label>
                        <Select
                          value={newAp.supplier_id}
                          onValueChange={(val) => setNewAp({ ...newAp, supplier_id: val })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Pilih Supplier" />
                          </SelectTrigger>
                          <SelectContent>
                            {suppliers.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setIsAddApOpen(false)}>Batal</Button>
                      <Button onClick={handleAddAp}>Simpan</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Keterangan</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Tgl Catat</TableHead>
                      <TableHead>Jatuh Tempo</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Terbayar</TableHead>
                      <TableHead className="text-right">Sisa</TableHead>
                      <TableHead className="text-right">Aksi</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payables.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                          Tidak ada data hutang
                        </TableCell>
                      </TableRow>
                    ) : (
                      payables.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col">
                              <span>{item.description}</span>
                              <span className="text-xs text-muted-foreground">{item.category}</span>
                            </div>
                          </TableCell>
                          <TableCell>{item.supplier_name || "-"}</TableCell>
                          <TableCell>{format(new Date(item.date), "dd MMM yyyy", { locale: idLocale })}</TableCell>
                          <TableCell>
                            {item.due_date ? format(new Date(item.due_date), "dd MMM yyyy", { locale: idLocale }) : "-"}
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(item.amount)}</TableCell>
                          <TableCell className="text-right text-green-600">{formatCurrency(item.amount_paid)}</TableCell>
                          <TableCell className="text-right text-red-600 font-bold">
                            {formatCurrency(item.amount - item.amount_paid)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" onClick={() => handleOpenPayment(item, 'ap')}>
                              Bayar
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Payment Dialog */}
        <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Catat Pembayaran</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Sisa Tagihan</Label>
                <div className="text-2xl font-bold">
                  {selectedItem && formatCurrency(selectedItem.total - selectedItem.current_paid)}
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pay_amount">Jumlah Bayar</Label>
                <Input
                  id="pay_amount"
                  type="number"
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                />
              </div>
              {selectedItem?.type === 'ap' && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Metode Bayar</Label>
                    <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VENDOR_PAYMENT_METHODS.map((method) => (
                          <SelectItem key={method.value} value={method.value}>
                            {method.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="pay_ref">No. Referensi</Label>
                    <Input
                      id="pay_ref"
                      placeholder="Transfer / cek / giro"
                      value={paymentReference}
                      onChange={(e) => setPaymentReference(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPaymentOpen(false)}>Batal</Button>
              <Button onClick={handleSubmitPayment}>Simpan Pembayaran</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </BackOfficeLayout>
  );
}
