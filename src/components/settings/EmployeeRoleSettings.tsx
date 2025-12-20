import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
} from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Plus, Edit, Trash2, Shield, Users } from "lucide-react";
import { toast } from "sonner";

interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Record<string, boolean>;
  userCount: number;
}

const permissionGroups = {
  dashboard: ["view_dashboard", "view_analytics"],
  pos: ["access_pos", "apply_discount", "void_transaction"],
  inventory: ["view_inventory", "add_stock", "transfer_stock", "stock_opname"],
  employees: ["view_employees", "add_employee", "edit_employee", "delete_employee"],
  reports: ["view_reports", "export_reports"],
  settings: ["view_settings", "edit_settings", "manage_roles"],
};

const permissionLabels: Record<string, string> = {
  view_dashboard: "Lihat Dashboard",
  view_analytics: "Lihat Analitik",
  access_pos: "Akses POS",
  apply_discount: "Berikan Diskon",
  void_transaction: "Void Transaksi",
  view_inventory: "Lihat Inventory",
  add_stock: "Tambah Stok",
  transfer_stock: "Transfer Stok",
  stock_opname: "Stock Opname",
  view_employees: "Lihat Karyawan",
  add_employee: "Tambah Karyawan",
  edit_employee: "Edit Karyawan",
  delete_employee: "Hapus Karyawan",
  view_reports: "Lihat Laporan",
  export_reports: "Export Laporan",
  view_settings: "Lihat Pengaturan",
  edit_settings: "Edit Pengaturan",
  manage_roles: "Kelola Role",
};

const initialRoles: Role[] = [
  {
    id: "1",
    name: "Super Admin",
    description: "Akses penuh ke semua fitur",
    permissions: Object.fromEntries(Object.values(permissionGroups).flat().map((p) => [p, true])),
    userCount: 2,
  },
  {
    id: "2",
    name: "Store Manager",
    description: "Kelola operasional toko",
    permissions: {
      view_dashboard: true,
      view_analytics: true,
      access_pos: true,
      apply_discount: true,
      view_inventory: true,
      add_stock: true,
      transfer_stock: true,
      view_employees: true,
      view_reports: true,
      export_reports: true,
    },
    userCount: 5,
  },
  {
    id: "3",
    name: "Cashier",
    description: "Operasi kasir dan POS",
    permissions: {
      view_dashboard: true,
      access_pos: true,
      apply_discount: false,
    },
    userCount: 24,
  },
  {
    id: "4",
    name: "Warehouse Staff",
    description: "Kelola gudang dan stok",
    permissions: {
      view_inventory: true,
      add_stock: true,
      transfer_stock: true,
      stock_opname: true,
    },
    userCount: 12,
  },
];

export function EmployeeRoleSettings() {
  const [roles, setRoles] = useState<Role[]>(initialRoles);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    permissions: {} as Record<string, boolean>,
  });

  const handleSave = () => {
    if (!formData.name) {
      toast.error("Nama role harus diisi");
      return;
    }

    if (editingRole) {
      setRoles((prev) =>
        prev.map((r) =>
          r.id === editingRole.id
            ? { ...r, name: formData.name, description: formData.description, permissions: formData.permissions }
            : r
        )
      );
      toast.success("Role berhasil diperbarui");
    } else {
      setRoles((prev) => [
        ...prev,
        {
          id: Date.now().toString(),
          name: formData.name,
          description: formData.description,
          permissions: formData.permissions,
          userCount: 0,
        },
      ]);
      toast.success("Role berhasil ditambahkan");
    }

    setIsDialogOpen(false);
    setEditingRole(null);
    setFormData({ name: "", description: "", permissions: {} });
  };

  const handleEdit = (role: Role) => {
    setEditingRole(role);
    setFormData({
      name: role.name,
      description: role.description,
      permissions: { ...role.permissions },
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: string) => {
    setRoles((prev) => prev.filter((r) => r.id !== id));
    toast.success("Role berhasil dihapus");
  };

  const togglePermission = (permission: string) => {
    setFormData((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [permission]: !prev.permissions[permission],
      },
    }));
  };

  return (
    <div className="bg-card rounded-xl border p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between pb-4 border-b">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-primary/10">
            <Shield className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">Role & Permission</h3>
            <p className="text-sm text-muted-foreground">Kelola role dan hak akses karyawan</p>
          </div>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button
              size="sm"
              className="gap-2"
              onClick={() => {
                setEditingRole(null);
                setFormData({ name: "", description: "", permissions: {} });
              }}
            >
              <Plus className="w-4 h-4" />
              Tambah Role
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingRole ? "Edit Role" : "Tambah Role Baru"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Nama Role</Label>
                <Input
                  placeholder="Contoh: Finance Manager"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Deskripsi</Label>
                <Input
                  placeholder="Deskripsi singkat role ini"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Permissions</Label>
                <Accordion type="multiple" className="w-full">
                  {Object.entries(permissionGroups).map(([group, permissions]) => (
                    <AccordionItem key={group} value={group}>
                      <AccordionTrigger className="text-sm capitalize">{group}</AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-3 pt-2">
                          {permissions.map((permission) => (
                            <div key={permission} className="flex items-center justify-between">
                              <Label className="text-sm font-normal cursor-pointer">
                                {permissionLabels[permission] || permission}
                              </Label>
                              <Switch
                                checked={formData.permissions[permission] || false}
                                onCheckedChange={() => togglePermission(permission)}
                              />
                            </div>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setIsDialogOpen(false)}>
                Batal
              </Button>
              <Button className="flex-1" onClick={handleSave}>
                Simpan
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead>Deskripsi</TableHead>
              <TableHead className="text-center">Pengguna</TableHead>
              <TableHead className="w-24"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {roles.map((role) => (
              <TableRow key={role.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    <span className="font-medium">{role.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{role.description}</TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary" className="gap-1">
                    <Users className="w-3 h-3" />
                    {role.userCount}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="iconSm" onClick={() => handleEdit(role)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      className="text-destructive"
                      onClick={() => handleDelete(role.id)}
                      disabled={role.name === "Super Admin"}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
