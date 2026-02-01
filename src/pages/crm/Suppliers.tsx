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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Search,
  Plus,
  Edit,
  Trash2,
  Phone,
  Mail,
  MapPin,
  Loader2,
  Building2,
  Download,
} from "lucide-react";
import { toast } from "sonner";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import * as XLSX from "xlsx";

interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  settings: {
    auto_send_low_stock_alert: boolean;
  };
  created_at: string;
}

export default function Suppliers() {
  const { user } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Dialog State
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    contact_person: "",
    phone: "",
    email: "",
    address: "",
    auto_send_low_stock_alert: false,
  });

  const fetchSuppliers = async () => {
    try {
      setIsLoading(true);
      const res = await query(`
        SELECT * FROM suppliers 
        ORDER BY name ASC
      `);
      
      const mappedSuppliers: Supplier[] = res.rows.map((row: any) => ({
        ...row,
        settings: row.settings || { auto_send_low_stock_alert: false },
      }));
      
      setSuppliers(mappedSuppliers);
    } catch (error) {
      console.error("Failed to fetch suppliers:", error);
      toast.error("Gagal mengambil data supplier");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const handleOpenAdd = () => {
    setIsEditing(false);
    setCurrentId(null);
    setFormData({
      name: "",
      contact_person: "",
      phone: "",
      email: "",
      address: "",
      auto_send_low_stock_alert: false,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (supplier: Supplier) => {
    setIsEditing(true);
    setCurrentId(supplier.id);
    setFormData({
      name: supplier.name,
      contact_person: supplier.contact_person || "",
      phone: supplier.phone || "",
      email: supplier.email || "",
      address: supplier.address || "",
      auto_send_low_stock_alert: supplier.settings?.auto_send_low_stock_alert || false,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast.error("Nama supplier wajib diisi");
      return;
    }

    try {
      const settingsJson = JSON.stringify({
        auto_send_low_stock_alert: formData.auto_send_low_stock_alert
      });

      if (isEditing && currentId) {
        await query(
          `UPDATE suppliers 
           SET name=$1, contact_person=$2, phone=$3, email=$4, address=$5, settings=$6
           WHERE id=$7`,
          [
            formData.name,
            formData.contact_person || null,
            formData.phone || null,
            formData.email || null,
            formData.address || null,
            settingsJson,
            currentId
          ]
        );
        toast.success("Supplier berhasil diperbarui");
        
        await logAudit({
          action: "update",
          entity: "suppliers",
          entityId: currentId,
          details: { name: formData.name },
          userId: user?.id
        });
      } else {
        const res = await query(
          `INSERT INTO suppliers (name, contact_person, phone, email, address, settings)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id`,
          [
            formData.name,
            formData.contact_person || null,
            formData.phone || null,
            formData.email || null,
            formData.address || null,
            settingsJson
          ]
        );
        const newId = res.rows[0].id;
        toast.success("Supplier berhasil ditambahkan");
        
        await logAudit({
          action: "create",
          entity: "suppliers",
          entityId: newId,
          details: { name: formData.name },
          userId: user?.id
        });
      }

      setIsDialogOpen(false);
      fetchSuppliers();
    } catch (error) {
      console.error("Failed to save supplier:", error);
      toast.error("Gagal menyimpan supplier");
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus supplier "${name}"?`)) return;

    try {
      // Check if used in products
      // Note: This is a simplified check. Ideally check foreign keys or handle error code.
      // But since we are using neon db via serverless driver, simple try-catch might catch FK constraint violation.
      
      await query(`DELETE FROM suppliers WHERE id = $1`, [id]);
      toast.success("Supplier berhasil dihapus");
      fetchSuppliers();
      
      await logAudit({
        action: "delete",
        entity: "suppliers",
        entityId: id,
        details: { name },
        userId: user?.id
      });
    } catch (error: any) {
      console.error("Failed to delete supplier:", error);
      if (error.message?.includes("violates foreign key constraint")) {
        toast.error("Tidak dapat menghapus supplier karena sedang digunakan oleh produk atau data lain.");
      } else {
        toast.error("Gagal menghapus supplier");
      }
    }
  };

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (s.contact_person && s.contact_person.toLowerCase().includes(searchQuery.toLowerCase())) ||
    (s.email && s.email.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleExport = () => {
    if (suppliers.length === 0) {
      toast.error("Tidak ada data supplier untuk diexport");
      return;
    }

    const exportData = suppliers.map(s => ({
      "Nama Supplier": s.name,
      "Contact Person": s.contact_person || "-",
      "Telepon": s.phone || "-",
      "Email": s.email || "-",
      "Alamat": s.address || "-",
      "Low Stock Alert": s.settings?.auto_send_low_stock_alert ? "Ya" : "Tidak"
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Supplier");

    // Auto-width columns
    const wscols = [
      { wch: 30 }, // Nama
      { wch: 20 }, // Contact Person
      { wch: 15 }, // Telepon
      { wch: 25 }, // Email
      { wch: 40 }, // Alamat
      { wch: 15 }, // Low Stock Alert
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, `Data_Supplier_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Berhasil export data supplier");
  };

  return (
    <BackOfficeLayout>
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Data Supplier</h1>
            <p className="text-muted-foreground">
              Kelola data pemasok dan informasi kontak.
            </p>
          </div>
          <Button onClick={handleOpenAdd}>
            <Plus className="mr-2 h-4 w-4" /> Tambah Supplier
          </Button>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Cari supplier..."
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button variant="outline" className="gap-2" onClick={handleExport}>
            <Download className="w-4 h-4" />
            Export Excel
          </Button>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama Supplier</TableHead>
                <TableHead>Kontak</TableHead>
                <TableHead>Telepon</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Alamat</TableHead>
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
              ) : filteredSuppliers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    Tidak ada supplier ditemukan.
                  </TableCell>
                </TableRow>
              ) : (
                filteredSuppliers.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {supplier.name}
                      </div>
                    </TableCell>
                    <TableCell>{supplier.contact_person || "-"}</TableCell>
                    <TableCell>
                      {supplier.phone ? (
                        <div className="flex items-center gap-1">
                          <Phone className="h-3 w-3 text-muted-foreground" />
                          {supplier.phone}
                        </div>
                      ) : "-"}
                    </TableCell>
                    <TableCell>
                      {supplier.email ? (
                        <div className="flex items-center gap-1">
                          <Mail className="h-3 w-3 text-muted-foreground" />
                          {supplier.email}
                        </div>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate" title={supplier.address || ""}>
                      {supplier.address || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(supplier)}
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(supplier.id, supplier.name)}
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
            <DialogTitle>{isEditing ? "Edit Supplier" : "Tambah Supplier Baru"}</DialogTitle>
            <DialogDescription>
              Isi informasi lengkap supplier di bawah ini.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nama Supplier <span className="text-destructive">*</span></Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="PT. Sumber Makmur"
                required
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="contact_person">Contact Person</Label>
                <Input
                  id="contact_person"
                  value={formData.contact_person}
                  onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                  placeholder="Bpk. Budi"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="phone">Telepon</Label>
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="0812..."
                />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="info@supplier.com"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="address">Alamat</Label>
              <Textarea
                id="address"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                placeholder="Jl. Raya No. 123..."
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3 shadow-sm">
              <div className="space-y-0.5">
                <Label htmlFor="low-stock-alert">Low Stock Alert</Label>
                <div className="text-[0.8rem] text-muted-foreground">
                  Kirim email otomatis saat stok produk dari supplier ini menipis.
                </div>
              </div>
              <Switch
                id="low-stock-alert"
                checked={formData.auto_send_low_stock_alert}
                onCheckedChange={(checked) => 
                  setFormData({ ...formData, auto_send_low_stock_alert: checked })
                }
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Batal
              </Button>
              <Button type="submit">
                {isEditing ? "Simpan Perubahan" : "Tambah Supplier"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </BackOfficeLayout>
  );
}
