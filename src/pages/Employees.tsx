import { useState, useEffect } from "react";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search,
  Plus,
  MoreHorizontal,
  Users,
  Building2,
  UserCheck,
  UserX,
  Download,
  Edit,
  Trash2,
  Mail,
  Loader2,
} from "lucide-react";
import * as XLSX from "xlsx";
import { query } from "@/lib/db";
import { toast } from "sonner";
import { ROLES, DEFAULT_ROLE_PERMISSIONS, PERMISSION_LABELS } from "@/config/roles";
import { authClient } from "@/lib/auth-client";

interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  assigned_branch_id: string | null;
  branch_name: string | null;
  is_active: boolean;
  created_at: string;
  base_salary: number;
}

interface Branch {
  id: string;
  name: string;
}

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState("Semua");
  const [selectedBranchFilter, setSelectedBranchFilter] = useState("Semua");

  // Add Employee State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newEmpName, setNewEmpName] = useState("");
  const [newEmpEmail, setNewEmpEmail] = useState("");
  const [newEmpPassword, setNewEmpPassword] = useState("");
  const [newEmpRole, setNewEmpRole] = useState("cashier");
  const [newEmpBranch, setNewEmpBranch] = useState("");
  const [newEmpSalary, setNewEmpSalary] = useState("0");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Employee State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editBranch, setEditBranch] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);
  const [editSalary, setEditSalary] = useState("0");

  // Delete State
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const renderPermissions = (roleVal: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const permissions = DEFAULT_ROLE_PERMISSIONS[roleVal as any];
    if (!permissions) return null;
    const granted = Object.entries(permissions).filter(([, val]) => val).map(([key]) => key);
    if (granted.length === 0) return null;
    return (
      <div className="mt-2 p-3 bg-muted/50 rounded-lg">
        <p className="text-xs font-semibold mb-2 text-muted-foreground">Permission Role Ini:</p>
        <div className="flex flex-wrap gap-1">
          {granted.map(p => (
              <Badge key={p} variant="secondary" className="text-[10px] px-1.5 py-0.5 h-5 bg-background border shadow-sm">
                  {PERMISSION_LABELS[p] || p}
              </Badge>
          ))}
        </div>
      </div>
    );
  };

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch Branches
      const branchRes = await query("SELECT id, name FROM branches ORDER BY name");
      setBranches(branchRes.rows);

      // Fetch Employees
      const empRes = await query(`
        SELECT u.id, u.name, u.email, u.role, u.assigned_branch_id, u.is_active, u.created_at, u.base_salary, b.name as branch_name
        FROM users u
        LEFT JOIN branches b ON u.assigned_branch_id = b.id
        ORDER BY u.created_at DESC
      `);
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setEmployees(empRes.rows.map((r: any) => ({
        ...r,
        // Normalize role to lowercase for consistency
        role: r.role?.toLowerCase() || 'staff',
        base_salary: Number(r.base_salary) || 0
      })));
    } catch (error) {
      console.error("Failed to fetch data:", error);
      toast.error("Gagal memuat data karyawan");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddEmployee = async () => {
    if (!newEmpName || !newEmpEmail || !newEmpPassword || !newEmpRole) {
      toast.error("Mohon lengkapi nama, email, password, dan role");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Create User via Neon Auth API
      // Prioritize Admin API to avoid overwriting current session (Owner)
      const authUrl = import.meta.env.VITE_NEON_AUTH_URL;
      if (!authUrl) throw new Error("Neon Auth URL not configured");

      const passwordToUse = newEmpPassword; 
      let userId: string | undefined;

      // Try Admin API first (doesn't sign in the new user)
      try {
        const adminRes = await fetch(`${authUrl}/admin/create-user`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: newEmpEmail,
                password: passwordToUse,
                name: newEmpName,
                role: "user" // Default role in Auth system, actual role managed in public.users
            }),
        });

        if (adminRes.ok) {
            const adminData = await adminRes.json();
            userId = adminData.user?.id || adminData.id;
        } 
      } catch (e) {
        // Ignore network errors here to fall back
        console.warn("Admin API failed, falling back to sign-up", e);
      }

      // Fallback to Sign Up if Admin API failed (or not available)
      // Note: This might overwrite the session if running in same browser context!
      if (!userId) {
          const signUpRes = await fetch(`${authUrl}/sign-up/email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: newEmpEmail,
              password: passwordToUse,
              name: newEmpName,
            }),
          });

          if (signUpRes.ok) {
             const authData = await signUpRes.json();
             userId = authData.user?.id || authData.session?.userId;
             
             // Warning about potential session switch
             toast.info("Akun auth dibuat. Jika sesi Anda berubah, silakan login kembali.");
          } else {
             const errData = await signUpRes.json();
             console.warn("Neon Auth creation warning:", errData);
             if (signUpRes.status === 422 || signUpRes.status === 409) {
                 throw new Error("Email sudah terdaftar di sistem Auth. Silahkan gunakan email lain.");
             }
             throw new Error(errData.message || "Gagal membuat akun Neon Auth");
          }
      }

      if (!userId) {
         throw new Error("Gagal mendapatkan User ID dari Neon Auth");
      }

      // 2. Insert into users table
      await query(
        `INSERT INTO users (id, tenant_id, email, role, assigned_branch_id, is_active, name, base_salary) 
         VALUES ($1, current_setting('app.current_tenant_id')::uuid, $2, $3, $4, true, $5, $6)
         ON CONFLICT (id) DO UPDATE 
         SET role = $3, assigned_branch_id = $4, is_active = true, name = $5, base_salary = $6`,
        [userId, newEmpEmail, newEmpRole, newEmpBranch || null, newEmpName, parseFloat(newEmpSalary) || 0]
      );

      toast.success("Karyawan berhasil ditambahkan");
      setIsAddOpen(false);
      setNewEmpName("");
      setNewEmpEmail("");
      setNewEmpPassword("");
      setNewEmpBranch("");
      fetchData();
    } catch (error) {
      console.error("Failed to add employee:", error);
      toast.error("Gagal menambahkan karyawan");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (emp: Employee) => {
    setEditingEmployee(emp);
    setEditName(emp.name || "");
    setEditRole(emp.role);
    setEditBranch(emp.assigned_branch_id || "no_branch");
    setEditIsActive(emp.is_active);
    setEditSalary(emp.base_salary.toString());
    setIsEditOpen(true);
  };

  const handleUpdateEmployee = async () => {
    if (!editingEmployee) return;

    setIsSubmitting(true);
    try {
      const branchId = editBranch === "no_branch" ? null : editBranch;
      await query(
        `UPDATE users SET role = $1, assigned_branch_id = $2, is_active = $3, name = $4, base_salary = $5 WHERE id = $6`,
        [editRole, branchId, editIsActive, editName, parseFloat(editSalary) || 0, editingEmployee.id]
      );

      toast.success("Data karyawan diperbarui");
      setIsEditOpen(false);
      setEditingEmployee(null);
      fetchData();
    } catch (error) {
      console.error("Failed to update employee:", error);
      toast.error("Gagal memperbarui karyawan");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEmployee = (id: string) => {
    setDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    
    try {
        await query(`DELETE FROM users WHERE id = $1`, [deleteId]);
        toast.success("Karyawan dihapus");
        fetchData();
    } catch (error) {
        console.error("Failed to delete:", error);
        toast.error("Gagal menghapus karyawan");
    } finally {
        setDeleteId(null);
    }
  };

  const filteredEmployees = employees.filter((emp) => {
    const matchesSearch =
      emp.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole =
      selectedRole === "Semua" || emp.role === selectedRole;
    const matchesBranch = selectedBranchFilter === "Semua" || 
        (selectedBranchFilter === "Pusat" && !emp.assigned_branch_id) ||
        emp.branch_name === selectedBranchFilter;
        
    return matchesSearch && matchesRole && matchesBranch;
  });

  const totalEmployees = employees.length;
  const activeEmployeesCount = employees.filter((e) => e.is_active).length;

  const handleExport = () => {
    if (employees.length === 0) {
      toast.error("Tidak ada data karyawan untuk diexport");
      return;
    }

    const exportData = employees.map(e => ({
      "Nama": e.name,
      "Email": e.email,
      "Role": e.role,
      "Cabang": e.branch_name || "-",
      "Status": e.is_active ? "Aktif" : "Nonaktif",
      "Gaji Pokok": e.base_salary,
      "Tanggal Bergabung": new Date(e.created_at).toLocaleDateString('id-ID')
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Karyawan");

    // Auto-width columns
    const wscols = [
      { wch: 20 }, // Nama
      { wch: 25 }, // Email
      { wch: 15 }, // Role
      { wch: 15 }, // Cabang
      { wch: 10 }, // Status
      { wch: 15 }, // Gaji
      { wch: 20 }, // Tanggal
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, `Data_Karyawan_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Berhasil export data karyawan");
  };

  return (
    <BackOfficeLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Data Karyawan</h1>
            <p className="text-muted-foreground mt-1">
              Kelola karyawan dan penempatan cabang
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" className="gap-2" onClick={handleExport}>
              <Download className="w-4 h-4" />
              Export
            </Button>
            <Button className="gap-2" onClick={() => setIsAddOpen(true)}>
              <Plus className="w-4 h-4" />
              Tambah Karyawan
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Karyawan</p>
                <p className="text-2xl font-bold">{totalEmployees}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-success/10">
                <UserCheck className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Aktif</p>
                <p className="text-2xl font-bold text-success">{activeEmployeesCount}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-warning/10">
                <UserX className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Tidak Aktif</p>
                <p className="text-2xl font-bold text-warning">
                  {totalEmployees - activeEmployeesCount}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-info/10">
                <Building2 className="w-5 h-5 text-info" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Cabang</p>
                <p className="text-xl font-bold">{branches.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Cari karyawan..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Semua">Semua Role</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r.value} value={r.value}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedBranchFilter} onValueChange={setSelectedBranchFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Cabang" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Semua">Semua Cabang</SelectItem>
              <SelectItem value="Pusat">Pusat (No Branch)</SelectItem>
              {branches.map((branch) => (
                <SelectItem key={branch.id} value={branch.name}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Employees Table */}
        <div className="bg-card rounded-xl border overflow-hidden animate-fade-in">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Karyawan</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                    <TableCell colSpan={5} className="text-center py-8">
                        <div className="flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                    </TableCell>
                </TableRow>
              ) : filteredEmployees.length === 0 ? (
                 <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        Tidak ada data karyawan
                    </TableCell>
                </TableRow>
              ) : (
                filteredEmployees.map((emp) => (
                <TableRow 
                  key={emp.id} 
                  className="group hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => handleEditClick(emp)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage />
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {emp.name
                            ? emp.name.split(" ").map((n) => n[0]).join("").substring(0,2).toUpperCase()
                            : "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{emp.name || "Unnamed"}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Mail className="w-3 h-3" />
                          {emp.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                     <Badge variant="outline" className="capitalize">
                        {emp.role.replace('_', ' ')}
                     </Badge>
                  </TableCell>
                  <TableCell>
                    {emp.branch_name ? (
                        <Badge variant="secondary">{emp.branch_name}</Badge>
                    ) : (
                        <span className="text-muted-foreground text-sm">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={emp.is_active ? "default" : "destructive"}
                      className={
                        emp.is_active
                          ? "bg-success/20 text-success hover:bg-success/30"
                          : ""
                      }
                    >
                      {emp.is_active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={(e) => e.stopPropagation()}>
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEditClick(emp)}>
                          <Edit className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive" onClick={() => handleDeleteEmployee(emp.id)}>
                          <Trash2 className="w-4 h-4 mr-2" />
                          Hapus
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Add Employee Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Tambah Karyawan Baru</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nama Lengkap</Label>
              <Input
                id="name"
                value={newEmpName}
                onChange={(e) => setNewEmpName(e.target.value)}
                placeholder="Contoh: Budi Santoso"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={newEmpEmail}
                onChange={(e) => setNewEmpEmail(e.target.value)}
                placeholder="budi@retailpro.id"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={newEmpPassword}
                onChange={(e) => setNewEmpPassword(e.target.value)}
                placeholder="******"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="salary">Gaji Pokok</Label>
              <Input
                id="salary"
                type="number"
                value={newEmpSalary}
                onChange={(e) => setNewEmpSalary(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                    <Label>Role</Label>
                    <Select value={newEmpRole} onValueChange={setNewEmpRole}>
                        <SelectTrigger>
                        <SelectValue placeholder="Pilih Role" />
                        </SelectTrigger>
                        <SelectContent>
                        {ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                            {r.label}
                            </SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="grid gap-2">
                    <Label>Cabang (Opsional)</Label>
                    <Select value={newEmpBranch} onValueChange={setNewEmpBranch}>
                        <SelectTrigger>
                        <SelectValue placeholder="Pilih Cabang" />
                        </SelectTrigger>
                        <SelectContent>
                        {branches.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                            {b.name}
                            </SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="col-span-2">
                    {renderPermissions(newEmpRole)}
                </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)} disabled={isSubmitting}>
              Batal
            </Button>
            <Button onClick={handleAddEmployee} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Employee Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
                <DialogTitle>Edit Karyawan</DialogTitle>
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
                    <Input value={editingEmployee?.email || ""} disabled />
                </div>
                <div className="grid gap-2">
                    <Label>Gaji Pokok</Label>
                    <Input 
                        type="number"
                        value={editSalary} 
                        onChange={(e) => setEditSalary(e.target.value)}
                        placeholder="0"
                    />
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                        <Label>Role</Label>
                        <Select value={editRole} onValueChange={setEditRole}>
                            <SelectTrigger>
                            <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                            {ROLES.map((r) => (
                                <SelectItem key={r.value} value={r.value}>
                                {r.label}
                                </SelectItem>
                            ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label>Cabang</Label>
                        <Select value={editBranch} onValueChange={setEditBranch}>
                            <SelectTrigger>
                            <SelectValue placeholder="Pilih Cabang" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="no_branch">Tanpa Cabang</SelectItem>
                                {branches.map((b) => (
                                    <SelectItem key={b.id} value={b.id}>
                                    {b.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                {renderPermissions(editRole)}
                <div className="flex items-center justify-between space-x-2 border p-3 rounded-md">
                    <Label htmlFor="edit-status" className="flex flex-col space-y-1">
                        <span>Status Aktif</span>
                        <span className="font-normal text-xs text-muted-foreground">
                            Karyawan nonaktif tidak bisa login
                        </span>
                    </Label>
                    <Switch
                        id="edit-status"
                        checked={editIsActive}
                        onCheckedChange={setEditIsActive}
                    />
                </div>
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsEditOpen(false)} disabled={isSubmitting}>
                    Batal
                </Button>
                <Button onClick={handleUpdateEmployee} disabled={isSubmitting}>
                    {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                    Simpan Perubahan
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Hapus Karyawan?</AlertDialogTitle>
                <AlertDialogDescription>
                    Tindakan ini tidak dapat dibatalkan. Data karyawan akan dihapus permanen dari sistem.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Hapus
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </BackOfficeLayout>
  );
}
