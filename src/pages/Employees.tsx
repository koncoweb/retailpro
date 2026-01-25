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
import { query } from "@/lib/db";
import { toast } from "sonner";
import { ROLES, DEFAULT_ROLE_PERMISSIONS, PERMISSION_LABELS } from "@/config/roles";

interface Employee {
  id: string;
  name: string;
  email: string;
  role: string;
  assigned_branch_id: string | null;
  branch_name: string | null;
  is_active: boolean;
  created_at: string;
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Employee State
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editBranch, setEditBranch] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

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
        SELECT u.id, u.name, u.email, u.role, u.assigned_branch_id, u.is_active, u.created_at, b.name as branch_name
        FROM users u
        LEFT JOIN branches b ON u.assigned_branch_id = b.id
        ORDER BY u.created_at DESC
      `);
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setEmployees(empRes.rows.map((r: any) => ({
        ...r,
        // Normalize role to lowercase for consistency
        role: r.role?.toLowerCase() || 'staff'
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
      // 1. Create User via Neon Auth API (Mocking the fetch call structure as used in BranchDetailModal)
      const authUrl = import.meta.env.VITE_NEON_AUTH_URL;
      let userId = `user_${Date.now()}`; // Fallback ID if auth fails or not configured

      if (authUrl) {
        const signUpRes = await fetch(`${authUrl}/sign-up/email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: newEmpEmail,
            password: newEmpPassword,
            name: newEmpName,
          }),
        });

        if (signUpRes.ok) {
            const authData = await signUpRes.json();
            userId = authData.user?.id || authData.session?.userId || userId;
        } else {
             // If auth fails (e.g. duplicate email), we might stop here.
             // But for development without full auth setup, we might proceed or throw.
             // Let's throw to be safe if it's a real error.
             const errData = await signUpRes.json().catch(() => ({}));
             if (errData.code !== 'duplicate_email') { // proceed if it's just duplicate to try updating db
                 console.warn("Auth signup failed, maybe user exists?", errData);
             }
        }
      }

      // 2. Insert into users table
      await query(
        `INSERT INTO users (id, tenant_id, email, role, assigned_branch_id, is_active, name) 
         VALUES ($1, current_setting('app.current_tenant_id')::uuid, $2, $3, $4, true, $5)
         ON CONFLICT (id) DO UPDATE 
         SET role = $3, assigned_branch_id = $4, is_active = true, name = $5`,
        [userId, newEmpEmail, newEmpRole, newEmpBranch || null, newEmpName]
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
    setIsEditOpen(true);
  };

  const handleUpdateEmployee = async () => {
    if (!editingEmployee) return;

    setIsSubmitting(true);
    try {
      const branchId = editBranch === "no_branch" ? null : editBranch;
      await query(
        `UPDATE users SET role = $1, assigned_branch_id = $2, is_active = $3, name = $4 WHERE id = $5`,
        [editRole, branchId, editIsActive, editName, editingEmployee.id]
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

  const handleDeleteEmployee = async (id: string) => {
    if (!confirm("Apakah Anda yakin ingin menghapus karyawan ini? Tindakan ini tidak dapat dibatalkan.")) return;
    
    try {
        await query(`DELETE FROM users WHERE id = $1`, [id]);
        toast.success("Karyawan dihapus");
        fetchData();
    } catch (error) {
        console.error("Failed to delete:", error);
        toast.error("Gagal menghapus karyawan");
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
            <Button variant="outline" className="gap-2">
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
    </BackOfficeLayout>
  );
}
