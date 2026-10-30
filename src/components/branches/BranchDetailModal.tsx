import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
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

/** Same-origin by default; `VITE_API_BASE_URL` only for split-origin dev. */
const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

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
  name: string;
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

/** A replenishment request this branch sent to the gudang. */
interface BranchRequest {
  id: string;
  request_number: string;
  status: StockRequestStatus;
  priority: string;
  created_at: string;
  items_count: number;
}

import { ROLES } from "@/config/roles";
import {
  STOCK_REQUEST_PRIORITY_LABEL,
  STOCK_REQUEST_STATUS_LABEL,
  type StockRequestStatus,
} from "@/lib/branch-orders";

interface BranchDetailModalProps {
  branch: Branch | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  const [requests, setRequests] = useState<BranchRequest[]>([]);
  /** Requests still moving through the workflow, not just the visible ten. */
  const [openRequestCount, setOpenRequestCount] = useState(0);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  /** Temporary password returned once by /api/admin/users. */
  const [generatedCredentials, setGeneratedCredentials] = useState<{
    email: string;
    password: string;
  } | null>(null);

  // Add Employee State
  const [isAddEmployeeOpen, setIsAddEmployeeOpen] = useState(false);
  const [newEmployeeEmail, setNewEmployeeEmail] = useState("");
  const [newEmployeePassword, setNewEmployeePassword] = useState("");
  const [newEmployeeRole, setNewEmployeeRole] = useState("cashier");
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);

  // Edit Employee State
  const [isEditEmployeeOpen, setIsEditEmployeeOpen] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editPassword, setEditPassword] = useState("");
  const [isUpdatingEmployee, setIsUpdatingEmployee] = useState(false);

  useEffect(() => {
    if (open && branch?.id) {
      fetchBranchDetails(branch.id);
    }
  }, [open, branch]);

  const fetchBranchDetails = async (branchId: string | number) => {
    setIsLoadingDetails(true);
    try {
      // Fetch Employees
      const empRes = await query(
        `SELECT id, email, name, role, is_active FROM users WHERE assigned_branch_id = $1`,
        [branchId]
      );
      
      // Fetch Inventory (Top 50 items). Stock sits in warehouses, so the tab
      // shows everything this store can actually sell: batches in any warehouse
      // mapped to it (its own backroom plus any shared/central warehouse).
      const invRes = await query(
        `SELECT pb.id, p.name as product_name, pb.batch_number, pb.quantity_current, pb.expiry_date 
         FROM product_batches pb 
         JOIN products p ON pb.product_id = p.id 
         JOIN branch_warehouses bw ON bw.warehouse_id = pb.warehouse_id
         WHERE bw.branch_id = $1 AND pb.quantity_current > 0
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

      // Replenishment requests: the last ten plus how many are still open.
      const reqRes = await query(
        `SELECT r.id, r.request_number, r.status, r.priority, r.created_at,
                (SELECT COUNT(*) FROM stock_request_items i WHERE i.request_id = r.id) AS items_count
         FROM stock_requests r
         WHERE r.branch_id = $1
         ORDER BY r.created_at DESC LIMIT 10`,
        [branchId]
      );

      const openRes = await query<{ open_count: number | string }>(
        `SELECT COUNT(*) AS open_count
         FROM stock_requests
         WHERE branch_id = $1
           AND status IN ('draft', 'submitted', 'approved', 'in_transit')`,
        [branchId]
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setEmployees(empRes.rows.map((r: any) => ({
        id: r.id,
        email: r.email,
        name: r.name,
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

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setRequests(reqRes.rows.map((r: any) => ({
        id: r.id,
        request_number: r.request_number,
        status: r.status,
        priority: r.priority,
        created_at: r.created_at,
        items_count: Number(r.items_count),
      })));

      setOpenRequestCount(Number(openRes.rows[0]?.open_count ?? 0));

    } catch (error) {
      console.error("Failed to fetch branch details:", error);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleEditClick = (employee: Employee) => {
    setSelectedEmployee(employee);
    setEditName(employee.name || "");
    setEditRole(employee.role);
    setEditIsActive(employee.is_active);
    setEditPassword(""); // Reset password field
    setIsEditEmployeeOpen(true);
  };

  const handleUpdateEmployee = async () => {
    if (!selectedEmployee || !branch?.id) return;

    setIsUpdatingEmployee(true);
    try {
      // 1. Reset the password on the control plane when the field is filled.
      //    Single endpoint, admin-role checked, password generated if left empty.
      if (editPassword) {
        const response = await fetch(
          `${apiBase}/api/admin/users/${encodeURIComponent(selectedEmployee.id)}/password`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: editPassword.trim() }),
          }
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload: any = await response.json().catch(() => ({}));
        if (!response.ok) {
          toast.error(payload?.message || "Gagal mengganti password");
          setIsUpdatingEmployee(false);
          return;
        }
        if (payload?.tempPassword) {
          setGeneratedCredentials({ email: selectedEmployee.email, password: payload.tempPassword });
        }
        toast.success("Password berhasil diganti");
      }

      // 2. Update Application User Data
      await query(
        `UPDATE users SET role = $1, is_active = $2, name = $3 WHERE id = $4`,
        [editRole, editIsActive, editName, selectedEmployee.id]
      );

      // Refresh employees list
      await fetchBranchDetails(branch.id);

      setIsEditEmployeeOpen(false);
      setSelectedEmployee(null);
      toast.success("Data karyawan berhasil diperbarui");
    } catch (error) {
      console.error("Failed to update employee:", error);
      toast.error("Gagal memperbarui data karyawan");
    } finally {
      setIsUpdatingEmployee(false);
    }
  };

  const handleAddEmployee = async () => {
    if (!newEmployeeEmail || !newEmployeePassword || !newEmployeeRole || !branch?.id) {
        toast.error("Mohon lengkapi semua data");
        return;
    }
    
    setIsAddingEmployee(true);
    try {
      // 1. Create the identity on the control plane.
      const response = await fetch(`${apiBase}/api/admin/users`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmployeeEmail,
          name: newEmployeeEmail.split("@")[0],
          role: newEmployeeRole,
          branchId: branch.id,
        }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created: any = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(created?.message || "Gagal membuat akun karyawan");
      }

      const userId: string | undefined = created?.userId;
      if (!userId) {
        throw new Error("Gagal mendapatkan User ID dari server auth");
      }

      // 2. Mirror into this tenant's own `users` table (no tenant_id column any
      //    more: the database itself is the tenant).
      await query(
        `INSERT INTO users (id, email, role, assigned_branch_id, is_active) 
         VALUES ($1, $2, $3, $4, 1)
         ON CONFLICT (id) DO UPDATE 
         SET role = $3, assigned_branch_id = $4, is_active = 1`,
        [userId, newEmployeeEmail, newEmployeeRole, branch.id]
      );

      // Refresh employees list
      await fetchBranchDetails(branch.id);
      
      // Reset and close
      setNewEmployeeEmail("");
      setNewEmployeePassword("");
      setNewEmployeeRole("cashier");
      setIsAddEmployeeOpen(false);
      setGeneratedCredentials({ email: newEmployeeEmail, password: created.tempPassword });
      toast.success("Karyawan berhasil ditambahkan", {
        description: "Bagikan password sementara yang tampil sekarang — password tidak bisa dilihat lagi.",
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
            <TabsList className="grid w-full grid-cols-5">
              <TabsTrigger value="overview">Ringkasan</TabsTrigger>
              <TabsTrigger value="employees">Karyawan ({employees.length})</TabsTrigger>
              <TabsTrigger value="inventory">Stok ({inventory.length})</TabsTrigger>
              <TabsTrigger value="transactions">Transaksi</TabsTrigger>
              <TabsTrigger value="requests">Pesanan ({openRequestCount})</TabsTrigger>
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
                          <TableHead>Karyawan</TableHead>
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
                            <TableRow 
                              key={emp.id}
                              className="cursor-pointer hover:bg-muted/50 transition-colors"
                              onClick={() => handleEditClick(emp)}
                            >
                              <TableCell>
                                <div>
                                    <p className="font-medium">{emp.name || "Unnamed"}</p>
                                    <p className="text-sm text-muted-foreground">{emp.email}</p>
                                </div>
                              </TableCell>
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

              {/* Pesanan (replenishment) Tab */}
              <TabsContent value="requests" className="animate-in fade-in-50">
                {isLoadingDetails ? (
                  <div className="flex justify-center py-10"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
                ) : (
                  <div className="border rounded-lg overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>No. Pesanan</TableHead>
                          <TableHead>Tanggal</TableHead>
                          <TableHead className="text-center">Baris</TableHead>
                          <TableHead className="text-center">Prioritas</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {requests.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                              Belum ada pesanan ke gudang
                            </TableCell>
                          </TableRow>
                        ) : (
                          requests.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="font-mono text-xs">{r.request_number}</TableCell>
                              <TableCell className="text-sm">
                                <div className="flex items-center gap-2">
                                  <Calendar className="w-3 h-3 text-muted-foreground" />
                                  {new Date(r.created_at).toLocaleDateString('id-ID')}
                                </div>
                              </TableCell>
                              <TableCell className="text-center">{r.items_count}</TableCell>
                              <TableCell className="text-center">
                                <Badge variant={r.priority === "urgent" ? "destructive" : "secondary"}>
                                  {STOCK_REQUEST_PRIORITY_LABEL[r.priority] ?? r.priority}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-center">
                                <Badge variant="secondary">
                                  {STOCK_REQUEST_STATUS_LABEL[r.status] ?? r.status}
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
                  {ROLES.filter(r => !['platform_owner', 'tenant_owner'].includes(r.value)).map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
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

      {/* Edit Employee Dialog */}
      <Dialog open={isEditEmployeeOpen} onOpenChange={setIsEditEmployeeOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit Data Karyawan</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Nama</Label>
              <Input 
                  value={editName} 
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Nama Karyawan"
              />
            </div>
            <div className="grid gap-2">
              <Label>Email</Label>
              <Input value={selectedEmployee?.email || ""} disabled />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-password">Password Baru (Opsional)</Label>
              <Input 
                id="edit-password"
                type="password"
                placeholder="Biarkan kosong jika tidak diubah"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-role">Role</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger id="edit-role">
                  <SelectValue placeholder="Pilih Role" />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter(r => !['platform_owner', 'tenant_owner'].includes(r.value)).map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between space-x-2 border p-3 rounded-md">
              <Label htmlFor="edit-active" className="cursor-pointer">Status Aktif</Label>
              <Switch
                id="edit-active"
                checked={editIsActive}
                onCheckedChange={setEditIsActive}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditEmployeeOpen(false)}>
              Batal
            </Button>
            <Button onClick={handleUpdateEmployee} disabled={isUpdatingEmployee}>
              {isUpdatingEmployee && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Simpan Perubahan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
            <Button variant="outline" onClick={() => setGeneratedCredentials(null)}>
              Tutup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
