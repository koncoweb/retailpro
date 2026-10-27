import { useState, useEffect } from "react";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BranchDetailModal } from "@/components/branches/BranchDetailModal";
import { toast } from "sonner";
import {
  Plus,
  MapPin,
  Users,
  Package,
  TrendingUp,
  Building2,
  Phone,
  Edit,
  Download,
} from "lucide-react";
import { query, runTransaction } from "@/lib/db";
import * as XLSX from "xlsx";

/** Same-origin by default; `VITE_API_BASE_URL` only for split-origin dev. */
const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type BranchType = "store" | "online" | "hybrid";

const BRANCH_TYPE_LABEL: Record<BranchType, string> = {
  store: "Toko Fisik",
  online: "Online",
  hybrid: "Toko + Online",
};

interface Branch {
  id: string; // Changed to string (UUID)
  name: string;
  code: string;
  address: string;
  phone: string;
  email: string;
  manager: string;
  employees: number;
  products: number;
  status: "active" | "inactive";
  salesThisMonth: number;
  salesTarget: number;
  type: BranchType;
  isHeadquarters: boolean;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

export default function Branches() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  /** Temporary password returned once by /api/admin/users. */
  const [generatedCredentials, setGeneratedCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: "",
    code: "",
    address: "",
    phone: "",
    email: "",
    manager: "", // This will be manager name or email
    createManagerUser: false,
    managerEmail: "",
    salesTarget: "50000000",
    type: "store" as BranchType,
    isHeadquarters: false,
  });

  const fetchBranches = async () => {
    try {
      setIsLoading(true);
      // Fetch branches with real data from the tenant database
      const res = await query(`
        SELECT 
          b.id, b.name, b.code, b.address, b.phone, b.email, b.status, b.sales_target,
          b.type, b.is_headquarters,
          (SELECT email FROM users WHERE assigned_branch_id = b.id AND role = 'store_manager' LIMIT 1) as manager_email,
          (SELECT count(*) FROM users WHERE assigned_branch_id = b.id) as employees,
          (SELECT count(DISTINCT pb.product_id) FROM product_batches pb
             JOIN branch_warehouses bw ON bw.warehouse_id = pb.warehouse_id
            WHERE bw.branch_id = b.id AND pb.quantity_current > 0) as products,
          (SELECT COALESCE(SUM(total_amount), 0) FROM transactions WHERE branch_id = b.id AND created_at >= date('now','start of month')) as sales_this_month
        FROM branches b
        ORDER BY b.is_headquarters DESC, b.name
      `);
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mappedBranches: Branch[] = res.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        code: row.code || "",
        address: row.address || "",
        phone: row.phone || "",
        email: row.email || "",
        manager: row.manager_email || "Belum ada manager",
        employees: parseInt(row.employees) || 0,
        products: parseInt(row.products) || 0,
        status: row.status as "active" | "inactive",
        salesThisMonth: parseFloat(row.sales_this_month) || 0,
        salesTarget: parseFloat(row.sales_target) || 0,
        type: (row.type as BranchType) || "store",
        isHeadquarters: Number(row.is_headquarters) === 1,
      }));
      
      setBranches(mappedBranches);
    } catch (error) {
      console.error("Failed to fetch branches:", error);
      toast.error("Gagal mengambil data cabang");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  const totalSales = branches.reduce((sum, b) => sum + b.salesThisMonth, 0);
  const totalEmployees = branches.reduce((sum, b) => sum + b.employees, 0);
  const totalProducts = branches.reduce((sum, b) => sum + b.products, 0);
  const activeBranches = branches.filter(b => b.status === "active").length;

  const handleRowClick = (branch: Branch) => {
    setSelectedBranch(branch);
    setIsDetailOpen(true);
  };

  const handleToggleStatus = async (e: React.MouseEvent, branch: Branch) => {
    e.stopPropagation();
    try {
      const newStatus = branch.status === "active" ? "inactive" : "active";
      await query(`UPDATE branches SET status = $1 WHERE id = $2`, [newStatus, branch.id]);
      
      setBranches(branches.map(b => {
        if (b.id === branch.id) {
          return { ...b, status: newStatus };
        }
        return b;
      }));
      
      toast.success(`Cabang ${branch.name} ${newStatus === "active" ? "diaktifkan" : "dinonaktifkan"}`);
    } catch (error) {
      toast.error("Gagal mengubah status cabang");
    }
  };

  const handleExport = () => {
    if (branches.length === 0) {
      toast.error("Tidak ada data cabang untuk diexport");
      return;
    }

    const exportData = branches.map(b => ({
      "Nama Cabang": b.name,
      "Kode": b.code,
      "Alamat": b.address,
      "Telepon": b.phone,
      "Email": b.email,
      "Manager": b.manager,
      "Jumlah Karyawan": b.employees,
      "Jumlah Produk": b.products,
      "Status": b.status === 'active' ? 'Aktif' : 'Nonaktif',
      "Target Penjualan": b.salesTarget,
      "Penjualan Bulan Ini": b.salesThisMonth
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Daftar Cabang");

    const wscols = [
      { wch: 25 }, // Nama
      { wch: 10 }, // Kode
      { wch: 40 }, // Alamat
      { wch: 15 }, // Telepon
      { wch: 25 }, // Email
      { wch: 25 }, // Manager
      { wch: 15 }, // Karyawan
      { wch: 15 }, // Produk
      { wch: 10 }, // Status
      { wch: 20 }, // Target
      { wch: 20 }, // Penjualan
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, `Daftar_Cabang_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Berhasil export data cabang");
  };

  const handleAddBranch = async () => {
    if (!formData.name || !formData.code) {
      toast.error("Nama dan kode cabang wajib diisi");
      return;
    }

    try {
      // 1. Insert Branch
      const res = await query(
        `INSERT INTO branches (name, code, address, phone, email, status, sales_target, type) 
         VALUES ($1, $2, $3, $4, $5, 'active', $6, $7) RETURNING id`,
        [
          formData.name,
          formData.code,
          formData.address,
          formData.phone,
          formData.email,
          parseFloat(formData.salesTarget),
          formData.type,
        ]
      );
      
      const newBranchId = res.rows[0].id;

      // 1b. Every branch is born with a stockroom and the mapping the POS uses
      //     to find it — a store with no warehouse could not ring up a sale.
      await runTransaction(async (tx) => {
        const warehouseRes = await tx.query<{ id: string }>(
          `INSERT INTO warehouses (name, code, type, branch_id, address, status, is_default)
           VALUES ($1, $2, 'store', $3, $4, 'active', 1) RETURNING id`,
          [
            `${formData.name} - Gudang`,
            `${formData.code}-GD`,
            newBranchId,
            formData.address || null,
          ]
        );
        await tx.query(
          `INSERT OR IGNORE INTO branch_warehouses (branch_id, warehouse_id, is_default, priority)
           VALUES ($1, $2, 1, 1)`,
          [newBranchId, warehouseRes.rows[0].id]
        );

        // The partial unique index allows one head office; stepping down first
        // is what makes "promote this branch" a legal update.
        if (formData.isHeadquarters) {
          await tx.query(
            `UPDATE branches SET is_headquarters = 0 WHERE id <> $1 AND is_headquarters = 1`,
            [newBranchId]
          );
          await tx.query(`UPDATE branches SET is_headquarters = 1 WHERE id = $1`, [newBranchId]);
        }
      });

      // 2. Create Manager User if requested
      if (formData.createManagerUser && formData.managerEmail) {
        try {
          // A. Create the identity on the control plane. The password is
          //    generated server-side and returned exactly once.
          const response = await fetch(`${apiBase}/api/admin/users`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: formData.managerEmail,
              name: formData.managerEmail.split("@")[0],
              role: "store_manager",
              branchId: newBranchId,
            }),
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const created: any = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(created?.message || "Gagal membuat akun manager");
          }

          const managerId: string | undefined = created?.userId;
          if (!managerId) {
            throw new Error("Gagal mendapatkan User ID dari server auth");
          }

          // B. Mirror into this tenant's own `users` table. The database itself
          //    is the tenant, so there is no tenant_id column any more.
          await query(
            `INSERT INTO users (id, email, role, assigned_branch_id, is_active)
             VALUES ($1, $2, 'store_manager', $3, 1)
             ON CONFLICT (id) DO UPDATE 
             SET role = 'store_manager', assigned_branch_id = $3, is_active = 1`,
            [managerId, formData.managerEmail, newBranchId]
          );

          setGeneratedCredentials({
            email: formData.managerEmail,
            password: created?.tempPassword ?? "",
          });
          toast.success(`User manager (${formData.managerEmail}) berhasil dibuat`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (authErr: any) {
           console.error("Manager creation failed:", authErr);
           toast.error(`Cabang dibuat, tapi gagal membuat user manager: ${authErr.message}`);
        }
      }

      toast.success("Cabang baru berhasil ditambahkan");
      setIsAddDialogOpen(false);
      setFormData({ 
        name: "", code: "", address: "", phone: "", email: "", 
        manager: "", createManagerUser: false, managerEmail: "", salesTarget: "50000000",
                type: "store", isHeadquarters: false 
      });
      fetchBranches();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(error);
      if (error.message?.includes('UNIQUE constraint failed') || error.message?.includes('users_email_idx') || error.code === '23505') {
        toast.error(`Email ${formData.managerEmail} sudah terdaftar. Gunakan email lain.`);
      } else {
        toast.error("Gagal menambahkan cabang: " + (error.message || "Unknown error"));
      }
    }
  };

  const handleEditBranch = (e: React.MouseEvent, branch: Branch) => {
    e.stopPropagation();
    setEditingBranch(branch);
    setFormData({
      name: branch.name,
      code: branch.code,
      address: branch.address,
      phone: branch.phone,
      email: branch.email,
      manager: branch.manager,
      createManagerUser: false,
      managerEmail: "",
      salesTarget: branch.salesTarget.toString(),
      type: branch.type,
      isHeadquarters: branch.isHeadquarters,
    });
  };

  const handleSaveEdit = async () => {
    if (!editingBranch) return;

    try {
      await runTransaction(async (tx) => {
        await tx.query(
          `UPDATE branches SET name=$1, code=$2, address=$3, phone=$4, email=$5, sales_target=$6, type=$7 WHERE id=$8`,
          [
            formData.name,
            formData.code,
            formData.address,
            formData.phone,
            formData.email,
            parseFloat(formData.salesTarget),
            formData.type,
            editingBranch.id,
          ]
        );

        // Moving the head-office flag is a two-step dance because of the
        // partial unique index: the incumbent must step down first.
        if (formData.isHeadquarters && !editingBranch.isHeadquarters) {
          await tx.query(
            `UPDATE branches SET is_headquarters = 0 WHERE id <> $1 AND is_headquarters = 1`,
            [editingBranch.id]
          );
          await tx.query(`UPDATE branches SET is_headquarters = 1 WHERE id = $1`, [editingBranch.id]);
        }
      });

      // If manager creation requested during edit
      if (formData.createManagerUser && formData.managerEmail) {
        try {
          // 1. Create the identity on the control plane.
          const response = await fetch(`${apiBase}/api/admin/users`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: formData.managerEmail,
              name: formData.managerEmail.split("@")[0],
              role: "store_manager",
              branchId: editingBranch.id,
            }),
          });

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const created: any = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(created?.message || "Gagal membuat akun manager");
          }

          const managerId: string | undefined = created?.userId;
          if (!managerId) {
            throw new Error("Gagal mendapatkan User ID dari server auth");
          }

          // 2. Mirror into the tenant `users` table. `ON CONFLICT (email)` with a
          //    `WHERE` guard is not valid SQLite, so reassignment is an explicit
          //    UPDATE that leaves owner-level roles untouched.
          await query(
            `INSERT INTO users (id, email, role, assigned_branch_id, is_active)
             VALUES ($1, $2, 'store_manager', $3, 1)
             ON CONFLICT (id) DO UPDATE SET assigned_branch_id = $3, role = 'store_manager'`,
            [managerId, formData.managerEmail, editingBranch.id]
          );
          await query(
            `UPDATE users SET assigned_branch_id = $1, role = 'store_manager'
             WHERE email = $2 AND role NOT IN ('platform_owner', 'tenant_owner')`,
            [editingBranch.id, formData.managerEmail]
          );

          setGeneratedCredentials({
            email: formData.managerEmail,
            password: created?.tempPassword ?? "",
          });
          toast.success(`User manager (${formData.managerEmail}) berhasil dibuat`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (authErr: any) {
           console.error("Manager creation failed:", authErr);
           toast.error(`Cabang diupdate, tapi gagal set user manager: ${authErr.message}`);
        }
      }

      toast.success("Cabang berhasil diupdate");
      setEditingBranch(null);
      setFormData({ 
        name: "", code: "", address: "", phone: "", email: "", 
        manager: "", createManagerUser: false, managerEmail: "", salesTarget: "50000000",
                type: "store", isHeadquarters: false 
      });
      fetchBranches();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error(error);
      toast.error("Gagal update cabang: " + (error.message || "Unknown error"));
    }
  };

  return (
    <BackOfficeLayout>
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Manajemen Cabang</h1>
            <p className="text-muted-foreground text-sm md:text-base mt-1">Kelola semua cabang dan pantau performanya</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={handleExport}>
              <Download className="w-4 h-4" />
              Export
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 w-full sm:w-auto"><Plus className="w-4 h-4" />Tambah Cabang</Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>Tambah Cabang Baru</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label>Nama Cabang *</Label>
                  <Input 
                    placeholder="Cabang Yogyakarta" 
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Kode *</Label>
                    <Input 
                      placeholder="YGY-01" 
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Telepon</Label>
                    <Input 
                      placeholder="0274-555-1234" 
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Alamat</Label>
                  <Input 
                    placeholder="Jl. Malioboro No. 100" 
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Email Cabang</Label>
                  <Input 
                    type="email" 
                    placeholder="yogyakarta@retailpro.id" 
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Target Penjualan (Bulanan)</Label>
                  <Input 
                    type="number"
                    placeholder="50000000" 
                    value={formData.salesTarget}
                    onChange={(e) => setFormData({ ...formData, salesTarget: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Jenis Cabang</Label>
                    <Select
                      value={formData.type}
                      onValueChange={(value) => setFormData({ ...formData, type: value as BranchType })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(BRANCH_TYPE_LABEL) as BranchType[]).map((type) => (
                          <SelectItem key={type} value={type}>{BRANCH_TYPE_LABEL[type]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Kantor Pusat</Label>
                    <div className="flex items-center gap-2 h-10">
                      <Checkbox
                        id="addHeadquarters"
                        checked={formData.isHeadquarters}
                        onCheckedChange={(checked) => setFormData({ ...formData, isHeadquarters: checked as boolean })}
                      />
                      <Label htmlFor="addHeadquarters" className="font-normal text-sm">Jadikan pusat</Label>
                    </div>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Gudang cabang beserta pemetaannya dibuat otomatis dan bisa diubah di menu Gudang.
                </p>

                <div className="border rounded-md p-4 space-y-4 bg-muted/20">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="createManager" 
                      checked={formData.createManagerUser}
                      onCheckedChange={(checked) => setFormData({ ...formData, createManagerUser: checked as boolean })}
                    />
                    <Label htmlFor="createManager" className="font-medium">Buat User untuk Manager Cabang?</Label>
                  </div>
                  
                  {formData.createManagerUser && (
                    <div className="grid gap-2 pl-6 border-l-2 border-primary/20">
                      <Label>Email Manager *</Label>
                      <Input 
                        placeholder="manager.ygy@retailpro.id" 
                        value={formData.managerEmail}
                        onChange={(e) => setFormData({ ...formData, managerEmail: e.target.value })}
                      />
                      <p className="text-xs text-muted-foreground">User akan dibuat dengan role 'store_manager' dan otomatis ditugaskan ke cabang ini.</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setIsAddDialogOpen(false)}>Batal</Button>
                <Button className="flex-1" onClick={handleAddBranch}>Simpan</Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </div>

        {/* Edit Dialog */}
        <Dialog open={!!editingBranch} onOpenChange={(open) => !open && setEditingBranch(null)}>
          <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit Cabang</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Nama Cabang *</Label>
                <Input 
                  placeholder="Cabang Yogyakarta" 
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Kode *</Label>
                  <Input 
                    placeholder="YGY-01" 
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Telepon</Label>
                  <Input 
                    placeholder="0274-555-1234" 
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Alamat</Label>
                <Input 
                  placeholder="Jl. Malioboro No. 100" 
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Email Cabang</Label>
                <Input 
                  type="email" 
                  placeholder="yogyakarta@retailpro.id" 
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                  <Label>Target Penjualan (Bulanan)</Label>
                  <Input 
                    type="number"
                    placeholder="50000000" 
                    value={formData.salesTarget}
                    onChange={(e) => setFormData({ ...formData, salesTarget: e.target.value })}
                  />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Jenis Cabang</Label>
                  <Select
                    value={formData.type}
                    onValueChange={(value) => setFormData({ ...formData, type: value as BranchType })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(BRANCH_TYPE_LABEL) as BranchType[]).map((type) => (
                        <SelectItem key={type} value={type}>{BRANCH_TYPE_LABEL[type]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Kantor Pusat</Label>
                  <div className="flex items-center gap-2 h-10">
                    <Checkbox
                      id="editHeadquarters"
                      checked={formData.isHeadquarters}
                      disabled={Boolean(editingBranch?.isHeadquarters)}
                      onCheckedChange={(checked) => setFormData({ ...formData, isHeadquarters: checked as boolean })}
                    />
                    <Label htmlFor="editHeadquarters" className="font-normal text-sm">
                      {editingBranch?.isHeadquarters ? "Sudah menjadi pusat" : "Jadikan pusat"}
                    </Label>
                  </div>
                </div>
              </div>

               <div className="border rounded-md p-4 space-y-4 bg-muted/20">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="editCreateManager" 
                      checked={formData.createManagerUser}
                      onCheckedChange={(checked) => setFormData({ ...formData, createManagerUser: checked as boolean })}
                    />
                    <Label htmlFor="editCreateManager" className="font-medium">Update/Buat User Manager?</Label>
                  </div>
                  
                  {formData.createManagerUser && (
                    <div className="grid gap-2 pl-6 border-l-2 border-primary/20">
                      <Label>Email Manager *</Label>
                      <Input 
                        placeholder="manager.ygy@retailpro.id" 
                        value={formData.managerEmail}
                        onChange={(e) => setFormData({ ...formData, managerEmail: e.target.value })}
                      />
                    </div>
                  )}
                </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditingBranch(null)}>Batal</Button>
              <Button className="flex-1" onClick={handleSaveEdit}>Simpan</Button>
            </div>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className="bg-card rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-2.5 rounded-lg bg-primary/10">
                <Building2 className="w-4 h-4 md:w-5 md:h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Total Cabang</p>
                <p className="text-xl md:text-2xl font-bold">{branches.length}</p>
                <p className="text-xs text-success">{activeBranches} aktif</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-2.5 rounded-lg bg-success/10">
                <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-success" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Total Penjualan</p>
                <p className="text-lg md:text-xl font-bold">{formatCurrency(totalSales)}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-2.5 rounded-lg bg-info/10">
                <Users className="w-4 h-4 md:w-5 md:h-5 text-info" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Total Karyawan</p>
                <p className="text-xl md:text-2xl font-bold">{totalEmployees}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-2.5 rounded-lg bg-warning/10">
                <Package className="w-4 h-4 md:w-5 md:h-5 text-warning" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Total Produk</p>
                <p className="text-xl md:text-2xl font-bold">{totalProducts.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cabang</TableHead>
                <TableHead className="hidden md:table-cell">Manager</TableHead>
                <TableHead className="text-center">Karyawan</TableHead>
                <TableHead className="text-center hidden sm:table-cell">Produk</TableHead>
                <TableHead className="text-right hidden lg:table-cell">Penjualan</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center w-24">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Belum ada data cabang. Silakan tambah cabang baru.
                  </TableCell>
                </TableRow>
              )}
              {branches.map((branch) => (
                <TableRow key={branch.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleRowClick(branch)}>
                  <TableCell>
                    <div className="flex items-center gap-2 md:gap-3">
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-medium text-sm md:text-base">{branch.name}</p>
                          {branch.isHeadquarters && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary">
                              Pusat
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs md:text-sm text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3 h-3" />{branch.code} · {BRANCH_TYPE_LABEL[branch.type]}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <p className="font-medium">{branch.manager}</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3 h-3" />{branch.phone}
                    </p>
                  </TableCell>
                  <TableCell className="text-center font-semibold">{branch.employees}</TableCell>
                  <TableCell className="text-center font-semibold hidden sm:table-cell">{branch.products.toLocaleString()}</TableCell>
                  <TableCell className="text-right hidden lg:table-cell">
                    <p className="font-semibold">{formatCurrency(branch.salesThisMonth)}</p>
                    <p className="text-xs text-muted-foreground">{((branch.salesThisMonth / (branch.salesTarget || 1)) * 100).toFixed(0)}% dari target</p>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={branch.status === "active"}
                        onCheckedChange={() => {}}
                        onClick={(e) => handleToggleStatus(e, branch)}
                      />
                      <Badge 
                        variant={branch.status === "active" ? "default" : "secondary"} 
                        className={branch.status === "active" ? "bg-success/20 text-success hover:bg-success/30" : ""}
                      >
                        {branch.status === "active" ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Button variant="ghost" size="icon" onClick={(e) => handleEditBranch(e, branch)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <BranchDetailModal open={isDetailOpen} onOpenChange={setIsDetailOpen} branch={selectedBranch} />

      {/* Temporary password: shown once, never stored anywhere else. */}
      <Dialog open={!!generatedCredentials} onOpenChange={(open) => !open && setGeneratedCredentials(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Password Sementara</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Catat dan bagikan sekarang. Password tidak dapat ditampilkan lagi.
            </p>
            <div className="rounded-md border bg-muted/40 p-3 font-mono text-xs space-y-1">
              <div className="break-all">
                <span className="text-muted-foreground">Email: </span>
                {generatedCredentials?.email}
              </div>
              <div className="break-all">
                <span className="text-muted-foreground">Password: </span>
                {generatedCredentials?.password}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                const value = `Email: ${generatedCredentials?.email}\nPassword: ${generatedCredentials?.password}`;
                void navigator.clipboard?.writeText(value);
                toast.success("Kredensial disalin");
              }}
            >
              Salin
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BackOfficeLayout>
  );
}
