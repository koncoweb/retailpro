import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Phone,
  Mail,
  Loader2,
  Users,
  ShoppingBag,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  total_spent: number;
  last_purchase_date: string | null;
  preferences: {
    notes?: string;
    favorite_category?: string;
  } | null;
  created_at: string;
}

export default function Customers() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    phone: "",
    email: "",
    notes: "",
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      minimumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("id-ID", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const fetchCustomers = async () => {
    try {
      setIsLoading(true);
      const res = await query(`
        SELECT * FROM customers 
        ORDER BY created_at DESC
      `);
      
      const mappedCustomers: Customer[] = res.rows.map((row: any) => ({
        ...row,
        total_spent: parseFloat(row.total_spent || "0"),
        preferences: row.preferences || {},
      }));
      
      setCustomers(mappedCustomers);
    } catch (error) {
      console.error("Failed to fetch customers:", error);
      toast.error("Gagal mengambil data pelanggan");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
  }, []);

  const handleOpenAdd = () => {
    setIsEditing(false);
    setCurrentId(null);
    setFormData({
      name: "",
      phone: "",
      email: "",
      notes: "",
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (customer: Customer) => {
    setIsEditing(true);
    setCurrentId(customer.id);
    setFormData({
      name: customer.name,
      phone: customer.phone || "",
      email: customer.email || "",
      notes: customer.preferences?.notes || "",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast.error("Nama pelanggan wajib diisi");
      return;
    }

    try {
      // Preserve existing preferences structure if editing, or create new
      const preferencesJson = JSON.stringify({
        notes: formData.notes
      });

      if (isEditing && currentId) {
        await query(
          `UPDATE customers 
           SET name=$1, phone=$2, email=$3, preferences=coalesce(preferences, '{}'::jsonb) || $4::jsonb
           WHERE id=$5`,
          [
            formData.name,
            formData.phone || null,
            formData.email || null,
            preferencesJson,
            currentId
          ]
        );
        toast.success("Pelanggan berhasil diperbarui");
        
        await logAudit({
          action: "update",
          entity: "customers",
          entityId: currentId,
          details: { name: formData.name },
          userId: user?.id
        });
      } else {
        const res = await query(
          `INSERT INTO customers (name, phone, email, preferences, total_spent)
           VALUES ($1, $2, $3, $4, 0)
           RETURNING id`,
          [
            formData.name,
            formData.phone || null,
            formData.email || null,
            preferencesJson
          ]
        );
        const newId = res.rows[0].id;
        toast.success("Pelanggan berhasil ditambahkan");
        
        await logAudit({
          action: "create",
          entity: "customers",
          entityId: newId,
          details: { name: formData.name },
          userId: user?.id
        });
      }

      setIsDialogOpen(false);
      fetchCustomers();
    } catch (error) {
      console.error("Failed to save customer:", error);
      toast.error("Gagal menyimpan pelanggan");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus pelanggan "${name}"?`)) return;

    try {
      await query(`DELETE FROM customers WHERE id = $1`, [id]);
      toast.success("Pelanggan berhasil dihapus");
      fetchCustomers();
      
      await logAudit({
        action: "delete",
        entity: "customers",
        entityId: id,
        details: { name },
        userId: user?.id
      });
    } catch (error: any) {
      console.error("Failed to delete customer:", error);
      if (error.message?.includes("violates foreign key constraint")) {
        toast.error("Tidak dapat menghapus pelanggan karena memiliki riwayat transaksi.");
      } else {
        toast.error("Gagal menghapus pelanggan");
      }
    }
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.phone && c.phone.includes(searchQuery)) ||
    (c.email && c.email.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <BackOfficeLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Data Pelanggan</h1>
            <p className="text-muted-foreground">
              Kelola data pelanggan dan riwayat belanja.
            </p>
          </div>
          <Button onClick={handleOpenAdd}>
            <Plus className="mr-2 h-4 w-4" /> Tambah Pelanggan
          </Button>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Cari pelanggan..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama Pelanggan</TableHead>
                <TableHead>Kontak</TableHead>
                <TableHead>Total Belanja</TableHead>
                <TableHead>Terakhir Beli</TableHead>
                <TableHead>Preferensi / Catatan</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />
                    Memuat data...
                  </TableCell>
                </TableRow>
              ) : filteredCustomers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Tidak ada pelanggan ditemukan.
                  </TableCell>
                </TableRow>
              ) : (
                filteredCustomers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        {customer.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-sm">
                        {customer.phone && (
                          <div className="flex items-center gap-1">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            {customer.phone}
                          </div>
                        )}
                        {customer.email && (
                          <div className="flex items-center gap-1">
                            <Mail className="h-3 w-3 text-muted-foreground" />
                            {customer.email}
                          </div>
                        )}
                        {!customer.phone && !customer.email && "-"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 font-medium">
                        <ShoppingBag className="h-3 w-3 text-muted-foreground" />
                        {formatCurrency(customer.total_spent)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {formatDate(customer.last_purchase_date)}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {customer.preferences?.notes || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(customer)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(customer.id, customer.name)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Pelanggan" : "Tambah Pelanggan Baru"}</DialogTitle>
            <DialogDescription>
              Isi informasi lengkap pelanggan di bawah ini.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nama Pelanggan <span className="text-destructive">*</span></Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Nama Lengkap"
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="phone">Telepon / WhatsApp</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="0812..."
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="customer@email.com"
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="notes">Catatan & Preferensi</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Misal: Suka produk organik, alergi kacang, member VIP..."
                className="h-24"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Batal
              </Button>
              <Button type="submit">
                {isEditing ? "Simpan Perubahan" : "Tambah Pelanggan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </BackOfficeLayout>
  );
}
