import { useState, useEffect } from "react";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search, Trash2, Download } from "lucide-react";
import * as XLSX from "xlsx";
import { query } from "@/lib/db";
import { toast } from "sonner";
import { format } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Expense {
  id: string;
  category: string;
  amount: number;
  date: string;
  description: string;
  created_at: string;
  branch_name: string | null;
  supplier_name: string | null;
}

interface Supplier {
  id: string;
  name: string;
}

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newExpense, setNewExpense] = useState({
    category: "",
    amount: "",
    date: format(new Date(), "yyyy-MM-dd"),
    description: "",
    supplier_id: "none", // or empty string
  });

  const fetchSuppliers = async () => {
    try {
      const res = await query("SELECT id, name FROM suppliers ORDER BY name ASC");
      setSuppliers(res.rows);
    } catch (error) {
      console.error("Failed to fetch suppliers:", error);
    }
  };

  const fetchExpenses = async () => {
    setIsLoading(true);
    try {
      const res = await query(`
        SELECT 
          e.id, 
          e.category, 
          e.amount, 
          e.date, 
          e.description, 
          e.created_at,
          b.name as branch_name,
          s.name as supplier_name
        FROM expenses e
        LEFT JOIN branches b ON e.branch_id = b.id
        LEFT JOIN suppliers s ON e.supplier_id = s.id
        ORDER BY e.date DESC, e.created_at DESC
      `);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setExpenses(res.rows.map((row: any) => ({
        ...row,
        amount: parseFloat(row.amount)
      })));
    } catch (error) {
      console.error("Failed to fetch expenses:", error);
      toast.error("Gagal memuat data pengeluaran");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchExpenses();
    fetchSuppliers();
  }, []);

  const handleAddExpense = async () => {
    if (!newExpense.category || !newExpense.amount || !newExpense.date) {
      toast.error("Mohon lengkapi data wajib");
      return;
    }

    try {
      await query(`
        INSERT INTO expenses (category, amount, date, description, status, amount_paid, supplier_id)
        VALUES ($1, $2, $3, $4, 'paid', $2, $5)
      `, [
        newExpense.category,
        parseFloat(newExpense.amount),
        newExpense.date,
        newExpense.description,
        newExpense.supplier_id === "none" || newExpense.supplier_id === "" ? null : newExpense.supplier_id
      ]);

      toast.success("Pengeluaran berhasil disimpan");
      setIsAddOpen(false);
      setNewExpense({
        category: "",
        amount: "",
        date: format(new Date(), "yyyy-MM-dd"),
        description: "",
        supplier_id: "none",
      });
      fetchExpenses();
    } catch (error) {
      console.error("Failed to add expense:", error);
      toast.error("Gagal menyimpan pengeluaran");
    }
  };

  const filteredExpenses = expenses.filter(
    (e) =>
      e.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleExport = () => {
    if (filteredExpenses.length === 0) {
      toast.error("Tidak ada data untuk diexport");
      return;
    }

    const data = filteredExpenses.map(e => ({
      "Tanggal": format(new Date(e.date), "dd MMM yyyy"),
      "Kategori": e.category,
      "Supplier": e.supplier_name || "-",
      "Cabang": e.branch_name || "Pusat/Semua",
      "Deskripsi": e.description || "-",
      "Jumlah": e.amount
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Pengeluaran");

    // Auto-width
    ws['!cols'] = [
      { wch: 15 }, // Tanggal
      { wch: 20 }, // Kategori
      { wch: 20 }, // Supplier
      { wch: 15 }, // Cabang
      { wch: 30 }, // Deskripsi
      { wch: 15 }, // Jumlah
    ];

    const filename = `Pengeluaran_${format(new Date(), "yyyy-MM-dd")}.xlsx`;
    XLSX.writeFile(wb, filename);
    toast.success("Berhasil export data pengeluaran");
  };

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Pengeluaran</h1>
            <p className="text-muted-foreground">Catat dan pantau pengeluaran operasional</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="gap-2" onClick={handleExport}>
              <Download className="h-4 w-4" /> Export Excel
            </Button>
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <Plus className="w-4 h-4" />
                  Tambah Pengeluaran
                </Button>
              </DialogTrigger>
              <DialogContent>
              <DialogHeader>
                <DialogTitle>Tambah Pengeluaran Baru</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Kategori</Label>
                  <Input 
                    placeholder="Contoh: Listrik, Sewa, Gaji"
                    value={newExpense.category}
                    onChange={(e) => setNewExpense({ ...newExpense, category: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Supplier (Opsional)</Label>
                  <Select
                    value={newExpense.supplier_id}
                    onValueChange={(val) => setNewExpense({ ...newExpense, supplier_id: val })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pilih Supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- Tidak Ada Supplier --</SelectItem>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Jumlah (Rp)</Label>
                  <Input 
                    type="number"
                    placeholder="0"
                    value={newExpense.amount}
                    onChange={(e) => setNewExpense({ ...newExpense, amount: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Tanggal</Label>
                  <Input 
                    type="date"
                    value={newExpense.date}
                    onChange={(e) => setNewExpense({ ...newExpense, date: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Deskripsi</Label>
                  <Input 
                    placeholder="Keterangan tambahan..."
                    value={newExpense.description}
                    onChange={(e) => setNewExpense({ ...newExpense, description: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddOpen(false)}>Batal</Button>
                <Button onClick={handleAddExpense}>Simpan</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Cari pengeluaran..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Riwayat Pengeluaran</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tanggal</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Cabang</TableHead>
                  <TableHead>Deskripsi</TableHead>
                  <TableHead className="text-right">Jumlah</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      Memuat data...
                    </TableCell>
                  </TableRow>
                ) : filteredExpenses.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Belum ada data pengeluaran
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredExpenses.map((expense) => (
                    <TableRow key={expense.id}>
                      <TableCell>{format(new Date(expense.date), "dd MMM yyyy")}</TableCell>
                      <TableCell>{expense.category}</TableCell>
                      <TableCell>{expense.supplier_name || "-"}</TableCell>
                      <TableCell>{expense.branch_name || "Pusat/Semua"}</TableCell>
                      <TableCell>{expense.description || "-"}</TableCell>
                      <TableCell className="text-right font-medium">
                        {new Intl.NumberFormat("id-ID", {
                          style: "currency",
                          currency: "IDR",
                          minimumFractionDigits: 0
                        }).format(expense.amount)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </BackOfficeLayout>
  );
}
