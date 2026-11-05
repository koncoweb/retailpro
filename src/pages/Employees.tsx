import { useState, useEffect, useMemo } from "react";
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
  Users,
  Building2,
  UserCheck,
  UserX,
  Download,
  Edit,
  Trash2,
  Mail,
  Loader2,
  KeyRound,
} from "lucide-react";
import * as XLSX from "xlsx";
import { query } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions, useBranchScope } from "@/hooks/use-permissions";
import { permissionLabel } from "@/lib/permission-matrix";
import { toast } from "sonner";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "@/lib/password";

/** Same-origin by default; `VITE_API_BASE_URL` only for split-origin dev. */
const apiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

/** Temporary password returned once by /api/admin/users. */
interface GeneratedCredentials {
  email: string;
  password: string;
}

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

/** One option in a role picker: whatever the matrix says the role is called. */
interface RoleOption {
  value: string;
  label: string;
  description: string;
  custom: boolean;
}

/** Sends a request to the identity endpoints, throwing the admin's message. */
async function identityRequest(path: string, method: "PATCH" | "DELETE" | "POST", body?: unknown) {
  const response = await fetch(`${apiBase}/api/admin/users${path}`, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Gagal menyimpan perubahan pada server.");
  }
  return payload;
}

export default function Employees() {
  // The acting user is recorded on every audit entry, so an employee change
  // can be traced back to whoever made it.
  const { user } = useAuth();
  const { can, grants, loading: permissionsLoading } = usePermissions();
  const { branchIds } = useBranchScope();

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
  // Shown under the field once the admin submits an unusable password; cleared
  // as soon as the typed value becomes valid.
  const [newEmpPasswordError, setNewEmpPasswordError] = useState<string | null>(null);
  const [newEmpRole, setNewEmpRole] = useState("cashier");
  const [newEmpBranch, setNewEmpBranch] = useState("no_branch");
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

  // One-time password dialog (never a toast: it is the only copy of the password)
  const [generatedCredentials, setGeneratedCredentials] = useState<GeneratedCredentials | null>(null);

  /**
   * The role picker's contents, read from the resolved matrix rather than from
   * a hard-coded list: builtins an admin may hand out, plus whatever custom
   * roles this tenant invented. Owners are left out — the endpoint refuses to
   * hand one out, so offering it would only produce an error message.
   */
  const roleOptions = useMemo<RoleOption[]>(() => {
    const options: RoleOption[] = [];
    for (const [key, grant] of Object.entries(grants)) {
      if (key === "admin") continue; // legacy alias of tenant_admin
      if (key === "tenant_owner" || key === "platform_owner") continue;
      options.push({
        value: key,
        label: grant.label,
        description: grant.description,
        custom: !grant.builtin,
      });
    }
    return options.sort((a, b) => Number(a.custom) - Number(b.custom) || a.label.localeCompare(b.label));
  }, [grants]);

  /** Branches this admin may assign: their own scope, whatever that is. */
  const assignableBranches = useMemo(() => {
    if (!branchIds) return branches;
    return branches.filter((b) => branchIds.includes(b.id));
  }, [branches, branchIds]);

  /**
   * What the role can actually do, for the person about to hand it out.
   *
   * This reads the resolved grant, not `DEFAULT_ROLE_PERMISSIONS`, so an
   * override saved on the Role screen is what the admin sees here — the whole
   * point of the matrix is that there is one answer to the question.
   */
  const renderPermissions = (roleVal: string) => {
    const grant = grants[roleVal];
    if (!grant) return null;
    const granted = Object.entries(grant.permissions)
      .filter(([, val]) => val)
      .map(([key]) => permissionLabel(key));
    if (granted.length === 0) {
      return (
        <div className="mt-2 rounded-lg bg-muted/50 p-3">
          <p className="text-xs text-muted-foreground">
            Role ini belum punya izin apa pun.{" "}
            {grant.builtin
              ? "Atur haknya di Pengaturan > Role."
              : "Centang izinnya di Pengaturan > Role."}
          </p>
        </div>
      );
    }
    return (
      <div className="mt-2 p-3 bg-muted/50 rounded-lg">
        <p className="text-xs font-semibold mb-2 text-muted-foreground">
          {grant.label} bisa:
        </p>
        <div className="flex flex-wrap gap-1">
          {granted.map((label) => (
            <Badge
              key={label}
              variant="secondary"
              className="text-[10px] px-1.5 py-0.5 h-5 bg-background border shadow-sm"
            >
              {label}
            </Badge>
          ))}
        </div>
      </div>
    );
  };

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (!isAddOpen) {
      document.body.style.pointerEvents = "auto";
    }
  }, [isAddOpen]);

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
    if (!newEmpName || !newEmpEmail || !newEmpRole) {
      toast.error("Mohon lengkapi nama, email, dan role");
      return;
    }

    // The employee signs in with this password, so a weak one is refused here
    // (beside the field) and again by the API, which other callers reach too.
    const problem = passwordProblem(newEmpPassword);
    if (problem) {
      setNewEmpPasswordError(problem);
      return;
    }
    setNewEmpPasswordError(null);

    setIsSubmitting(true);
    try {
      // 1. Create the identity on the control plane.
      //    `/api/admin/users` wraps Better Auth's admin API: it never switches the
      //    caller's session and it returns the generated password exactly once.
      const response = await fetch(`${apiBase}/api/admin/users`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmpEmail,
          name: newEmpName,
          role: newEmpRole,
          branchId: newEmpBranch === "no_branch" ? null : newEmpBranch,
          // The password typed here is the one the employee signs in with; the
          // endpoint only generates one when this is empty.
          password: newEmpPassword,
        }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 409) {
          throw new Error("Email sudah terdaftar. Silakan gunakan email lain.");
        }
        if (created?.error === "weak_password") {
          throw new Error(`Password minimal ${MIN_PASSWORD_LENGTH} karakter`);
        }
        throw new Error(created?.message || "Gagal membuat akun karyawan");
      }

      const userId: string | undefined = created?.userId;
      if (!userId) {
        throw new Error("Gagal mendapatkan User ID dari server auth");
      }

      // 2. Mirror the identity into this tenant's own `users` table so joins
      //    (cashier names, branch assignment) keep working. Salary is the one
      //    field only the tenant database holds.
      const branchId = newEmpBranch === "no_branch" ? null : newEmpBranch;
      await query(
        `INSERT INTO users (id, email, role, assigned_branch_id, is_active, name, base_salary) 
         VALUES ($1, $2, $3, $4, 1, $5, $6)
         ON CONFLICT (id) DO UPDATE 
         SET role = $3, assigned_branch_id = $4, is_active = 1, name = $5, base_salary = $6`,
        [userId, newEmpEmail, newEmpRole, branchId, newEmpName, parseFloat(newEmpSalary) || 0]
      );

      // The temporary password is shown once, in a copy dialog rather than a toast.
      await logAudit({
        action: "create_employee",
        entity: "users",
        entityId: userId,
        userId: user?.id,
        details: {
          email: newEmpEmail,
          name: newEmpName,
          role: newEmpRole,
          branch_id: branchId,
          base_salary: parseFloat(newEmpSalary) || 0,
        },
      });

      setGeneratedCredentials({ email: newEmpEmail, password: created.tempPassword });
      toast.success("Karyawan berhasil ditambahkan");
      setIsAddOpen(false);
      setNewEmpName("");
      setNewEmpEmail("");
      setNewEmpPassword("");
      setNewEmpPasswordError(null);
      setNewEmpBranch("no_branch");
      fetchData();
    } catch (error) {
      console.error("Failed to add employee:", error);
      // The thrown messages above are written for the admin, not for the console.
      toast.error(error instanceof Error ? error.message : "Gagal menambahkan karyawan");
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

  /**
   * The one writer of an employee's identity.
   *
   * This screen used to `UPDATE users` — the tenant's projection — and call it
   * done, while every route guard asks the control-plane session. The two are no
   * longer in the page's hands: `/api/admin/users/[id]` writes the identity first
   * and mirrors the projection, so a role change here is the change the person
   * meets the next time they sign in. Salary stays a tenant field.
   */
  const handleUpdateEmployee = async () => {
    if (!editingEmployee) return;

    setIsSubmitting(true);
    try {
      const branchId = editBranch === "no_branch" ? null : editBranch;
      await identityRequest(`/${editingEmployee.id}`, "PATCH", {
        name: editName,
        role: editRole,
        branchId,
        active: editIsActive,
      });

      const nextSalary = parseFloat(editSalary) || 0;
      if (nextSalary !== editingEmployee.base_salary) {
        await query(`UPDATE users SET base_salary = $1 WHERE id = $2`, [
          nextSalary,
          editingEmployee.id,
        ]);
      }

      // Record the before/after so a role or salary change is auditable —
      // this is the screen that can grant someone manager permissions.
      await logAudit({
        action: "update_employee",
        entity: "users",
        entityId: editingEmployee.id,
        userId: user?.id,
        details: {
          before: {
            name: editingEmployee.name,
            role: editingEmployee.role,
            branch_id: editingEmployee.assigned_branch_id,
            is_active: editingEmployee.is_active,
            base_salary: editingEmployee.base_salary,
          },
          after: {
            name: editName,
            role: editRole,
            branch_id: branchId,
            is_active: editIsActive,
            base_salary: nextSalary,
          },
        },
      });

      toast.success(
        editIsActive
          ? "Data karyawan diperbarui"
          : "Karyawan dinonaktifkan; yang bersangkutan tidak bisa login lagi"
      );
      setIsEditOpen(false);
      setEditingEmployee(null);
      fetchData();
    } catch (error) {
      console.error("Failed to update employee:", error);
      toast.error(error instanceof Error ? error.message : "Gagal memperbarui karyawan");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteEmployee = (id: string) => {
    setDeleteId(id);
  };

  /**
   * Deleting an employee used to mean `DELETE FROM users`, i.e. dropping the
   * projection while the identity stayed alive, signed-in-able, and still
   * receiving a full-access token for the company database. The endpoint removes
   * the sessions, the credentials and the identity, then the projection row.
   */
  const confirmDelete = async () => {
    if (!deleteId) return;

    try {
        const removed = employees.find((emp) => emp.id === deleteId);
        await identityRequest(`/${deleteId}`, "DELETE");
        await logAudit({
            action: "delete",
            entity: "users",
            entityId: deleteId,
            userId: user?.id,
            details: { email: removed?.email ?? null, name: removed?.name ?? null, role: removed?.role ?? null },
        });
        toast.success("Karyawan dihapus");
        fetchData();
    } catch (error) {
        console.error("Failed to delete:", error);
        toast.error(error instanceof Error ? error.message : "Gagal menghapus karyawan");
    } finally {
        setDeleteId(null);
    }
  };

  /** Server-generated password, shown once, exactly like the add-employee flow. */
  const handleResetPassword = async (emp: Employee) => {
    try {
      const payload = await identityRequest(`/${emp.id}/password`, "POST", {});
      await logAudit({
        action: "reset_employee_password",
        entity: "users",
        entityId: emp.id,
        userId: user?.id,
        details: { email: emp.email },
      });
      setGeneratedCredentials({ email: emp.email, password: payload?.tempPassword });
    } catch (error) {
      console.error("Failed to reset password:", error);
      toast.error(error instanceof Error ? error.message : "Gagal mengubah password");
    }
  };

  /**
   * Two filters on top of the search box. The role filter lists the labels from
   * the matrix, so a custom role is findable by the name the owner gave it.
   */
  const filteredEmployees = useMemo(
    () =>
      employees.filter((emp) => {
        // Out-of-scope rows are not shown at all: a branch manager reads the
        // staff of their branch, and a list with holes in it is worse than a
        // sentence explaining whose list this is.
        if (branchIds && !branchIds.includes(emp.assigned_branch_id ?? "")) return false;
        const matchesSearch =
          emp.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
          emp.email?.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesRole = selectedRole === "Semua" || emp.role === selectedRole;
        const matchesBranch =
          selectedBranchFilter === "Semua" ||
          (selectedBranchFilter === "Pusat" && !emp.assigned_branch_id) ||
          emp.branch_name === selectedBranchFilter;

        return matchesSearch && matchesRole && matchesBranch;
      }),
    [employees, branchIds, searchQuery, selectedRole, selectedBranchFilter]
  );

  const totalEmployees = employees.length;
  const activeEmployeesCount = employees.filter((e) => e.is_active).length;
  const scopeSentence = useMemo(() => {
    if (!branchIds) return null;
    const names = branches.filter((b) => branchIds.includes(b.id)).map((b) => b.name);
    return names.length > 0
      ? `Anda hanya melihat karyawan di cabang: ${names.join(", ")}.`
      : "Cabang Anda tidak terdaftar, jadi tidak ada karyawan yang ditampilkan.";
  }, [branchIds, branches]);

  const handleExport = () => {
    if (filteredEmployees.length === 0) {
      toast.error("Tidak ada data karyawan untuk diexport");
      return;
    }

    const exportData = filteredEmployees.map(e => ({
      "Nama": e.name,
      "Email": e.email,
      "Role": roleLabel(e.role),
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
      { wch: 18 }, // Role
      { wch: 15 }, // Cabang
      { wch: 10 }, // Status
      { wch: 15 }, // Gaji
      { wch: 20 }, // Tanggal
    ];
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, `Data_Karyawan_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Berhasil export data karyawan");
  };

  /** Label of a role key, custom included; falls back to the raw key. */
  function roleLabel(key: string): string {
    return grants[key]?.label ?? key.replace(/_/g, " ");
  }

  /** Every row action lives in one place so the table and the cards match. */
  const rowActions = (emp: Employee) => {
    const isSelf = emp.id === user?.id;
    return (
      <div className="flex items-center justify-end gap-1">
        {can("edit_employee") && (
          <Button
            variant="ghost"
            size="iconTouch"
            aria-label={`Edit ${emp.name || emp.email}`}
            title="Edit karyawan"
            onClick={(e) => {
              e.stopPropagation();
              handleEditClick(emp);
            }}
          >
            <Edit className="w-4 h-4" />
          </Button>
        )}
        {can("edit_employee") && (
          <Button
            variant="ghost"
            size="iconTouch"
            aria-label={`Reset password ${emp.name || emp.email}`}
            title="Buat password baru"
            onClick={(e) => {
              e.stopPropagation();
              void handleResetPassword(emp);
            }}
          >
            <KeyRound className="w-4 h-4" />
          </Button>
        )}
        {can("delete_employee") && !isSelf && (
          <Button
            variant="ghost"
            size="iconTouch"
            aria-label={`Hapus ${emp.name || emp.email}`}
            title="Hapus karyawan"
            className="text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteEmployee(emp.id);
            }}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </div>
    );
  };

  const identity = (emp: Employee) => (
    <div className="flex items-center gap-3 min-w-0">
      <Avatar className="h-10 w-10 shrink-0">
        <AvatarImage />
        <AvatarFallback className="bg-primary/10 text-primary">
          {emp.name
            ? emp.name.split(" ").map((n) => n[0]).join("").substring(0,2).toUpperCase()
            : "?"}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="font-medium truncate">{emp.name || "Unnamed"}</p>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Mail className="w-3 h-3 shrink-0" />
          <span className="truncate">{emp.email}</span>
        </div>
      </div>
    </div>
  );

  const statusBadge = (emp: Employee) => (
    <Badge
      variant={emp.is_active ? "default" : "destructive"}
      className={emp.is_active ? "bg-success/20 text-success hover:bg-success/30" : ""}
    >
      {emp.is_active ? "Aktif" : "Nonaktif"}
    </Badge>
  );

  const roleSummary = (emp: Employee) => {
    const grant = grants[emp.role];
    const count = grant
      ? Object.values(grant.permissions).filter(Boolean).length
      : 0;
    return (
      <div className="space-y-0.5">
        <Badge variant="outline" className={grant && !grant.builtin ? "border-primary/60" : ""}>
          {roleLabel(emp.role)}
        </Badge>
        <p className="text-xs text-muted-foreground">
          {grant ? `${count} izin aktif` : "Role tidak dikenal"}
        </p>
      </div>
    );
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
          <div className="flex flex-wrap gap-2">
            {can("export_reports") && (
              <Button variant="outline" size="touch" className="gap-2" onClick={handleExport}>
                <Download className="w-4 h-4" />
                Export
              </Button>
            )}
            {can("add_employee") && (
              <Button size="touch" className="gap-2" onClick={() => setIsAddOpen(true)}>
                <Plus className="w-4 h-4" />
                Tambah Karyawan
              </Button>
            )}
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
                <p className="text-xl font-bold">{assignableBranches.length}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search & Filter — one row on a desktop, full-width stack on a phone */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 sm:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Cari nama atau email…"
              className="h-11 pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Select value={selectedRole} onValueChange={setSelectedRole}>
            <SelectTrigger className="h-11 w-full sm:w-44">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Semua">Semua Role</SelectItem>
              {roleOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedBranchFilter} onValueChange={setSelectedBranchFilter}>
            <SelectTrigger className="h-11 w-full sm:w-44">
              <SelectValue placeholder="Cabang" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Semua">Semua Cabang</SelectItem>
              <SelectItem value="Pusat">Pusat (No Branch)</SelectItem>
              {assignableBranches.map((branch) => (
                <SelectItem key={branch.id} value={branch.name}>
                  {branch.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1 text-sm text-muted-foreground">
          <p>
            Menampilkan {filteredEmployees.length} dari {totalEmployees} karyawan
          </p>
          {scopeSentence && <p>{scopeSentence}</p>}
        </div>

        {isLoading || permissionsLoading ? (
          <div className="flex justify-center rounded-xl border bg-card py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="rounded-xl border bg-card p-8 text-center">
            <p className="font-medium">Tidak ada karyawan yang cocok</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ubah kata kunci atau filter role/cabang, atau tambahkan karyawan baru.
            </p>
          </div>
        ) : (
          <>
            {/* Wide screens: the table */}
            <div className="hidden rounded-xl border bg-card md:block animate-fade-in">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Karyawan</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Cabang</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="w-36 text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEmployees.map((emp) => (
                    <TableRow
                      key={emp.id}
                      className="group hover:bg-muted/50 transition-colors cursor-pointer"
                      onClick={() => handleEditClick(emp)}
                    >
                      <TableCell>{identity(emp)}</TableCell>
                      <TableCell>{roleSummary(emp)}</TableCell>
                      <TableCell>
                        {emp.branch_name ? (
                          <Badge variant="secondary">{emp.branch_name}</Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">Pusat</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">{statusBadge(emp)}</TableCell>
                      <TableCell>{rowActions(emp)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Phones: stacked cards, so nothing needs a sideways scroll */}
            <div className="space-y-3 md:hidden">
              {filteredEmployees.map((emp) => (
                <div
                  key={emp.id}
                  className="rounded-xl border bg-card p-4 animate-fade-in"
                  onClick={() => handleEditClick(emp)}
                >
                  {identity(emp)}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {roleSummary(emp)}
                    <span className="text-muted-foreground">·</span>
                    {emp.branch_name ? (
                      <Badge variant="secondary">{emp.branch_name}</Badge>
                    ) : (
                      <Badge variant="outline">Pusat</Badge>
                    )}
                    {statusBadge(emp)}
                  </div>
                  <div className="mt-3 border-t pt-2">{rowActions(emp)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Add Employee Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
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
                onChange={(e) => {
                  setNewEmpPassword(e.target.value);
                  // Re-check only after a failed submit, so the field does not
                  // complain while the admin is still typing the first characters.
                  if (newEmpPasswordError) setNewEmpPasswordError(passwordProblem(e.target.value));
                }}
                aria-invalid={newEmpPasswordError ? true : undefined}
                aria-describedby={newEmpPasswordError ? "password-error" : undefined}
                placeholder={`minimal ${MIN_PASSWORD_LENGTH} karakter`}
              />
              <p className="text-xs text-muted-foreground">
                Dipakai karyawan untuk login pertama. Password hanya ditampilkan sekali setelah
                disimpan.
              </p>
              {newEmpPasswordError && (
                <p id="password-error" role="alert" className="text-xs text-destructive">
                  {newEmpPasswordError}
                </p>
              )}
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
            <div className="grid gap-4">
                <div className="grid gap-2">
                    <Label>Role</Label>
                    <Select value={newEmpRole} onValueChange={setNewEmpRole}>
                        <SelectTrigger className="h-11">
                        <SelectValue placeholder="Pilih Role" />
                        </SelectTrigger>
                        <SelectContent>
                        {roleOptions.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              <span className="flex flex-col">
                                <span>{r.label}</span>
                                {r.description && (
                                  <span className="text-xs text-muted-foreground">
                                    {r.description}
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="grid gap-2">
                    <Label>Cabang</Label>
                    {/* The edit form has always offered "Tanpa Cabang"; leaving it
                        out here meant a head-office hire silently ended up with no
                        branch and no way to say so on purpose. */}
                    <Select value={newEmpBranch} onValueChange={setNewEmpBranch}>
                        <SelectTrigger className="h-11">
                        <SelectValue placeholder="Pilih Cabang" />
                        </SelectTrigger>
                        <SelectContent>
                        <SelectItem value="no_branch">Tanpa Cabang (Pusat)</SelectItem>
                        {assignableBranches.map((b) => (
                            <SelectItem key={b.id} value={b.id}>
                            {b.name}
                            </SelectItem>
                        ))}
                        </SelectContent>
                    </Select>
                </div>
                {renderPermissions(newEmpRole)}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="touch" onClick={() => setIsAddOpen(false)} disabled={isSubmitting}>
              Batal
            </Button>
            <Button size="touch" onClick={handleAddEmployee} disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Simpan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Employee Dialog */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
                <DialogTitle>Edit Karyawan</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                    <Label>Nama</Label>
                    <Input
                        className="h-11"
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
                        className="h-11"
                        type="number"
                        value={editSalary}
                        onChange={(e) => setEditSalary(e.target.value)}
                        placeholder="0"
                    />
                </div>
                <div className="grid gap-4">
                    <div className="grid gap-2">
                        <Label>Role</Label>
                        <Select value={editRole} onValueChange={setEditRole}>
                            <SelectTrigger className="h-11">
                            <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                            {roleOptions.map((r) => (
                                <SelectItem key={r.value} value={r.value}>
                                  <span className="flex flex-col">
                                    <span>{r.label}</span>
                                    {r.description && (
                                      <span className="text-xs text-muted-foreground">
                                        {r.description}
                                      </span>
                                    )}
                                  </span>
                                </SelectItem>
                            ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2">
                        <Label>Cabang</Label>
                        <Select value={editBranch} onValueChange={setEditBranch}>
                            <SelectTrigger className="h-11">
                            <SelectValue placeholder="Pilih Cabang" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="no_branch">Tanpa Cabang (Pusat)</SelectItem>
                                {assignableBranches.map((b) => (
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
                {editingEmployee && editingEmployee.id === user?.id && (
                  <p className="text-xs text-muted-foreground">
                    Ini akun Anda sendiri. Server menolak mengubah role atau status akun yang
                    sedang Anda pakai, supaya Anda tidak mengunci diri sendiri.
                  </p>
                )}
            </div>
            <DialogFooter>
                <Button variant="outline" size="touch" onClick={() => setIsEditOpen(false)} disabled={isSubmitting}>
                    Batal
                </Button>
                <Button size="touch" onClick={handleUpdateEmployee} disabled={isSubmitting}>
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
                    Tindakan ini tidak dapat dibatalkan. Akun karyawan dihapus dari sistem, sesi
                    login-nya ditutup, dan yang bersangkutan tidak bisa masuk lagi.
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

      {/* Temporary password: the server returns it exactly once. */}
      <Dialog open={!!generatedCredentials} onOpenChange={(open) => !open && setGeneratedCredentials(null)}>
        <DialogContent className="max-w-md">
            <DialogHeader>
                <DialogTitle>Password Sementara</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                    Catat password ini sekarang. Password tidak dapat ditampilkan lagi dan harus
                    segera diganti oleh karyawan setelah login pertama.
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
                    size="touch"
                    onClick={() => {
                        const value = `Email: ${generatedCredentials?.email}\nPassword: ${generatedCredentials?.password}`;
                        void navigator.clipboard?.writeText(value);
                        toast.success("Kredensial disalin");
                    }}
                >
                    Salin
                </Button>
                <Button variant="outline" size="touch" onClick={() => setGeneratedCredentials(null)}>
                    Tutup
                </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </BackOfficeLayout>
  );
}
