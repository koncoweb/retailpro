import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MapPin,
  Phone,
  Mail,
  Users,
  Package,
  TrendingUp,
  Building2,
  DollarSign,
  Loader2,
  Calendar,
  Plus,
  UserPlus,
} from "lucide-react";
import { query } from "@/lib/db";
import { formatCurrency } from "@/lib/formatters";

interface Branch {
  id: string | number;
  name: string;
  code: string;
  address: string;
  phone: string;
  email: string;
  manager: string;
  employees: number;
  products: number;
  status: string;
  salesThisMonth: number;
  salesTarget: number;
}

interface Employee {
  id: string;
  email: string;
  role: string;
  is_active: boolean;
}

interface InventoryItem {
  id: string;
  product_name: string;
  batch_number: string;
  quantity: number;
  expiry_date: string | null;
}

interface RecentTransaction {
  id: string;
  total_amount: number;
  created_at: string;
  status: string;
}

interface BranchDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: Branch | null;
}

export function BranchDetailModal({
  open,
  onOpenChange,
  branch,
}: BranchDetailModalProps) {
  const [activeTab, setActiveTab] = useState("overview");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<RecentTransaction[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);

  // Add Employee State
  const [isAddEmployeeOpen, setIsAddEmployeeOpen] = useState(false);
  const [newEmployeeEmail, setNewEmployeeEmail] = useState("");
  const [newEmployeePassword, setNewEmployeePassword] = useState("");
  const [newEmployeeRole, setNewEmployeeRole] = useState("cashier");
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);

  useEffect(() => {
    if (open && branch?.id) {
      fetchBranchDetails(branch.id);
    }
  }, [open, branch]);

  const fetchBranchDetails = async (branchId: string | number) => {
    setIsLoadingDetails(true);
    try {
      // Fetch Tenant ID & Branch Details
      const branchRes = await query(
        `SELECT tenant_id FROM branches WHERE id = $1`,
        [branchId]
      );
      if (branchRes.rows.length > 0) {
        setTenantId(branchRes.rows[0].tenant_id);
      }

      // Fetch Employees
      const empRes = await query(
        `SELECT id, email, role, is_active FROM users WHERE assigned_branch_id = $1`,
        [branchId]
      );
      
      // Fetch Inventory (Top 50 items)
      const invRes = await query(
        `SELECT pb.id, p.name as product_name, pb.batch_number, pb.quantity_current, pb.expiry_date 
         FROM product_batches pb 
         JOIN products p ON pb.product_id = p.id 
         WHERE pb.branch_id = $1 AND pb.quantity_current > 0
         ORDER BY p.name ASC LIMIT 50`,
        [branchId]
      );

      // Fetch Recent Transactions
      const transRes = await query(
        `SELECT id, total_amount, created_at, status 
         FROM transactions 
         WHERE branch_id = $1 
         ORDER BY created_at DESC LIMIT 10`,
        [branchId]
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setEmployees(empRes.rows.map((r: any) => ({
        id: r.id,
        email: r.email,
        role: r.role,
        is_active: r.is_active
      })));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setInventory(invRes.rows.map((r: any) => ({
        id: r.id,
        product_name: r.product_name,
        batch_number: r.batch_number,
        quantity: parseFloat(r.quantity_current),
        expiry_date: r.expiry_date
      })));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setTransactions(transRes.rows.map((r: any) => ({
        id: r.id,
        total_amount: parseFloat(r.total_amount),
        created_at: r.created_at,
        status: r.status
      })));

    } catch (error) {
      console.error("Failed to fetch branch details:", error);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleAddEmployee = async () => {
    if (!newEmployeeEmail || !newEmployeePassword || !newEmployeeRole || !branch?.id) {
        toast.error("Mohon lengkapi semua data");
        return;
    }
    
    setIsAddingEmployee(true);
    try {
      // 1. Create User via Neon Auth API
      // We use fetch directly to avoid client-side session state issues if possible,
      // though browser might still capture the session cookie.
      const authUrl = import.meta.env.VITE_NEON_AUTH_URL;
      if (!authUrl) throw new Error("Neon Auth URL not configured");

      const signUpRes = await fetch(`${authUrl}/sign-up/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmployeeEmail,
          password: newEmployeePassword,
          name: newEmployeeEmail.split("@")[0],
        }),
      });

      if (!signUpRes.ok) {
        const errData = await signUpRes.json();
        throw new Error(errData.message || "Gagal membuat akun Neon Auth");
      }

      const authData = await signUpRes.json();
      const userId = authData.user?.id || authData.session?.userId;

      if (!userId) {
          throw new Error("Gagal mendapatkan User ID dari Neon Auth");
      }

      // 2. Insert into Application Users Table
      // We use ON CONFLICT DO UPDATE to handle cases where user might exist in public.users but not properly linked
      await query(
        `INSERT INTO users (id, tenant_id, email, role, assigned_branch_id, is_active) 
         VALUES ($1, $2, $3, $4, $5, true)
         ON CONFLICT (id) DO UPDATE 
         SET role = $4, assigned_branch_id = $5, is_active = true`,
        [userId, tenantId, newEmployeeEmail, newEmployeeRole, branch.id]
      );

      // Refresh employees list
      await fetchBranchDetails(branch.id);
      
      // Reset and close
      setNewEmployeeEmail("");
      setNewEmployeePassword("");
      setNewEmployeeRole("cashier");
      setIsAddEmployeeOpen(false);
      toast.success("Karyawan berhasil ditambahkan", {
        description: "Akun Neon Auth telah dibuat. User bisa login dengan email & password.",
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      console.error("Failed to add employee:", error);
      toast.error("Gagal menambahkan karyawan", {
        description: error.message || "Email mungkin sudah terdaftar atau ada kesalahan sistem.",
      });
    } finally {
      setIsAddingEmployee(false);
    }
  };

  if (!branch) return null;

  const progress = (branch.salesThisMonth / branch.salesTarget) * 100;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3 text-xl">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <Building2 className="w-6 h-6 text-primary" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="flex items-center gap-2">
                  {branch.name}
                  <Badge
                    variant={branch.status === "active" ? "default" : "secondary"}
                    className={
                      branch.status === "active"
                        ? "bg-success/20 text-success hover:bg-success/30"
                        : ""
                    }
                  >
                    {branch.status === "active" ? "Aktif" : "Nonaktif"}
                  </Badge>
                </span>
                <span className="text-sm font-normal text-muted-foreground">{branch.code}</span>
              </div>
            </DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="overview" value={activeTab} onValueChange={setActiveTab} className="w-full mt-2">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Ringkasan</TabsTrigger>
              <TabsTrigger value="employees">Karyawan ({employees.length})</TabsTrigger>
              <TabsTrigger value="inventory">Stok ({inventory.length})</TabsTrigger>
              <TabsTrigger value="transactions">Transaksi</TabsTrigger>
            </TabsList>

            <div className="mt-4 min-h-[300px]">
              {/* Overview Tab */}
              <TabsContent value="overview" className="space-y-6 animate-in fade-in-50">
                {/* Contact Info */}
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                    Informasi Kontak
                  </h4>
                  <div className="grid gap-3">
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <MapPin className="w-5 h-5 text-primary" />
                      <div>
                        <p className="text-sm text-muted-foreground">Alamat</p>
                        <p className="font-medium">{branch.address || "-"}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                        <Phone className="w-5 h-5 text-info" />
                        <div>
                          <p className="text-sm text-muted-foreground">Telepon</p>
                          <p className="font-medium">{branch.phone || "-"}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                        <Mail className="w-5 h-5 text-info" />
                        <div>
                          <p className="text-sm text-muted-foreground">Email</p>
                          <p className="font-medium text-sm">{branch.email || "-"}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
                    Statistik Performa
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-4 bg-gradient-to-br from-primary/10 to-primary/5 rounded-xl border border-primary/20">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-primary/20">
                          <DollarSign className="w-5 h-5 text-primary" />
                        </div>
                        <div className="w-full">
                          <p className="text-sm text-muted-foreground">Total Penjualan (Bulan Ini)</p>
                          <p className="text-xl font-bold">{formatCurrency(branch.salesThisMonth)}</p>
                          <div className="mt-2">
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary rounded-full transition-all"
                                style={{ width: `${Math.min(progress, 100)}%` }}
                              />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              {progress.toFixed(0)}% dari target {formatCurrency(branch.salesTarget)}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-gradient-to-br from-info/10 to-info/5 rounded-xl border border-info/20">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-info/20">
                          <Users className="w-5 h-5 text-info" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Jumlah Karyawan</p>
                          <p className="text-3xl font-bold">{branch.employees}</p>
                          <p className="text-sm text-muted-foreground">orang terdaftar</p>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-gradient-to-br from-success/10 to-success/5 rounded-xl border border-success/20">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-success/20">
                          <Package className="w-5 h-5 text-success" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Stok Produk</p>
                          <p className="text-3xl font-bold">{branch.products.toLocaleString()}</p>
                          <p className="text-sm text-muted-foreground">batch aktif</p>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-gradient-to-br from-warning/10 to-warning/5 rounded-xl border border-warning/20">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg bg-warning/20">
                          <TrendingUp className="w-5 h-5 text-warning" />
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Manager</p>
                          <p className="text-lg font-bold truncate max-w-[150px]" title={branch.manager}>{branch.manager}</p>
                          <p className="text-sm text-muted-foreground">Penanggung Jawab</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Employees Tab */}
              <TabsContent value="employees" className="animate-in fade-in-50 space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-semibold">Daftar Karyawan</h3>
                  <Button size="sm" onClick={() => setIsAddEmployeeOpen(true)}>
                    <UserPlus className="w-4 h-4 mr-2" />
                    Tambah Karyawan
                  </Button>
                </div>

                {isLoadingDetails ? (
                  <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Email</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {employees.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                              Belum ada karyawan di cabang ini
                            </TableCell>
                          </TableRow>
                        ) : (
                          employees.map((emp) => (
                            <TableRow key={emp.id}>
                              <TableCell className="font-medium">{emp.email}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="capitalize">
                                  {emp.role.replace('_', ' ')}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant={emp.is_active ? "default" : "destructive"}>
                                  {emp.is_active ? "Aktif" : "Nonaktif"}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* Inventory Tab */}
              <TabsContent value="inventory" className="animate-in fade-in-50">
                 {isLoadingDetails ? (
                  <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Produk</TableHead>
                          <TableHead>Batch</TableHead>
                          <TableHead className="text-right">Stok</TableHead>
                          <TableHead className="text-right">Kadaluarsa</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {inventory.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                              Stok kosong
                            </TableCell>
                          </TableRow>
                        ) : (
                          inventory.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="font-medium">{item.product_name}</TableCell>
                              <TableCell className="text-muted-foreground text-sm">{item.batch_number}</TableCell>
                              <TableCell className="text-right font-bold">{item.quantity}</TableCell>
                              <TableCell className="text-right text-sm">
                                {item.expiry_date ? new Date(item.expiry_date).toLocaleDateString('id-ID') : '-'}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              {/* Transactions Tab */}
              <TabsContent value="transactions" className="animate-in fade-in-50">
                {isLoadingDetails ? (
                  <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID Transaksi</TableHead>
                          <TableHead>Waktu</TableHead>
                          <TableHead className="text-right">Total</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {transactions.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                              Belum ada transaksi
                            </TableCell>
                          </TableRow>
                        ) : (
                          transactions.map((t) => (
                            <TableRow key={t.id}>
                              <TableCell className="font-mono text-xs">{t.id.substring(0, 8)}...</TableCell>
                              <TableCell className="text-sm">
                                <div className="flex items-center gap-2">
                                  <Calendar className="w-3 h-3 text-muted-foreground" />
                                  {new Date(t.created_at).toLocaleDateString('id-ID')}
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(t.total_amount)}</TableCell>
                              <TableCell className="text-center">
                                <Badge variant={t.status === "completed" ? "default" : "secondary"}>
                                  {t.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Add Employee Dialog */}
      <Dialog open={isAddEmployeeOpen} onOpenChange={setIsAddEmployeeOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Tambah Karyawan Baru</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="nama@email.com"
                value={newEmployeeEmail}
                onChange={(e) => setNewEmployeeEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Masukkan password"
                value={newEmployeePassword}
                onChange={(e) => setNewEmployeePassword(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">Role / Jabatan</Label>
              <Select value={newEmployeeRole} onValueChange={setNewEmployeeRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Pilih role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="store_manager">Store Manager</SelectItem>
                  <SelectItem value="cashier">Cashier</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="bg-muted p-3 rounded-lg text-sm text-muted-foreground">
              <p>User akan ditambahkan ke cabang <strong>{branch?.name}</strong>.</p>
              <p className="mt-1 text-xs">Pastikan email aktif agar user bisa melakukan reset password/login nantinya.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddEmployeeOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleAddEmployee} disabled={isAddingEmployee}>
              {isAddingEmployee && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
