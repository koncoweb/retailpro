import { useState, useEffect } from "react";
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
} from "@/components/ui/dialog";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Edit, Shield, Users, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { ROLES, PERMISSION_GROUPS, PERMISSION_LABELS, DEFAULT_ROLE_PERMISSIONS } from "@/config/roles";
import { query } from "@/lib/db";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Record<string, boolean>;
  userCount: number;
}

export function EmployeeRoleSettings() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    permissions: {} as Record<string, boolean>,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchRoles();
  }, []);

  const fetchRoles = async () => {
    setIsLoading(true);
    try {
        // Fetch user counts and tenant settings in parallel
        const [countRes, tenantRes] = await Promise.all([
            query(`SELECT role, COUNT(*) as count FROM users GROUP BY role`),
            query(`SELECT settings FROM tenants WHERE id = current_setting('app.current_tenant_id')::uuid`)
        ]);

        const counts: Record<string, number> = {};
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        countRes.rows.forEach((row: any) => {
            if (row.role) counts[row.role.toLowerCase()] = parseInt(row.count);
        });

        const tenantSettings = tenantRes.rows[0]?.settings || {};
        const customPermissions = tenantSettings.role_permissions || {};

        // Map system roles to state
        const mappedRoles = ROLES.map(r => ({
            id: r.value,
            name: r.label,
            description: r.description,
            permissions: customPermissions[r.value] || DEFAULT_ROLE_PERMISSIONS[r.value] || {},
            userCount: counts[r.value] || 0
        }));

        setRoles(mappedRoles);
    } catch (error) {
        console.error("Failed to fetch roles data:", error);
        toast.error("Gagal memuat data role");
    } finally {
        setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (editingRole) {
      try {
          const updatedRoles = roles.map((r) =>
            r.id === editingRole.id
              ? { ...r, permissions: formData.permissions }
              : r
          );
          
          setRoles(updatedRoles);

          // Prepare persistence
          const allPermissions: Record<string, any> = {};
          updatedRoles.forEach(r => {
              allPermissions[r.id] = r.permissions;
          });

          await query(`
              UPDATE tenants 
              SET settings = jsonb_set(COALESCE(settings, '{}'), '{role_permissions}', $1) 
              WHERE id = current_setting('app.current_tenant_id')::uuid
          `, [JSON.stringify(allPermissions)]);

          toast.success("Permission berhasil diperbarui");
      } catch (error) {
          console.error("Failed to save permissions:", error);
          toast.error("Gagal menyimpan permission ke database");
      }
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
        {/* Add Role button removed as system roles are fixed */}
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Info Sistem</AlertTitle>
        <AlertDescription>
          Role dalam sistem ini bersifat tetap (System Roles). Anda dapat melihat dan menyesuaikan permission, 
          namun penambahan role baru dilakukan melalui update sistem.
        </AlertDescription>
      </Alert>

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
            {isLoading ? (
                <TableRow>
                    <TableCell colSpan={4} className="text-center py-4 text-muted-foreground">
                        Memuat data...
                    </TableCell>
                </TableRow>
            ) : roles.map((role) => (
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
                    {/* Delete button removed for system roles */}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
            <DialogTitle>Edit Permission: {editingRole?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
            <div className="space-y-2">
            <Label>Nama Role</Label>
            <Input
                value={formData.name}
                disabled
                className="bg-muted"
            />
            <p className="text-xs text-muted-foreground">Nama system role tidak dapat diubah</p>
            </div>
            <div className="space-y-2">
            <Label>Deskripsi</Label>
            <Input
                value={formData.description}
                disabled
                className="bg-muted"
            />
            </div>

            <div className="space-y-2">
            <Label>Permissions</Label>
            <Accordion type="multiple" className="w-full">
                {Object.entries(PERMISSION_GROUPS).map(([group, permissions]) => (
                <AccordionItem key={group} value={group}>
                    <AccordionTrigger className="text-sm capitalize">{group}</AccordionTrigger>
                    <AccordionContent>
                    <div className="space-y-3 pt-2">
                        {permissions.map((permission) => (
                        <div key={permission} className="flex items-center justify-between">
                            <Label className="text-sm font-normal cursor-pointer">
                            {PERMISSION_LABELS[permission] || permission}
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
            Simpan Perubahan
            </Button>
        </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
