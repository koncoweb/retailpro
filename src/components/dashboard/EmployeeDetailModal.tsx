import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, Building2 } from "lucide-react";
import { query } from "@/lib/db";

interface EmployeeDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Employee {
  id: string;
  name: string;
  role: string;
  branch_name: string;
  status: string; // "online" | "offline"
}

interface BranchEmployeeStat {
  name: string;
  count: number;
}

const roleColors: Record<string, string> = {
  "Store Manager": "bg-primary/20 text-primary",
  "Cashier": "bg-success/20 text-success",
  "Warehouse Staff": "bg-info/20 text-info",
  "Finance Staff": "bg-warning/20 text-warning",
};

export function EmployeeDetailModal({ open, onOpenChange }: EmployeeDetailModalProps) {
  const [activeEmployees, setActiveEmployees] = useState<Employee[]>([]);
  const [branchStats, setBranchStats] = useState<BranchEmployeeStat[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      fetchData();
    }
  }, [open]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch active employees
      // Assuming 'online' if they are active users. 
      // In a real app, we might check last_login or session table.
      const empRes = await query(`
        SELECT 
          u.id, 
          u.name, 
          u.role, 
          b.name as branch_name
        FROM users u
        LEFT JOIN branches b ON u.assigned_branch_id = b.id
        WHERE u.is_active = true
        ORDER BY b.name, u.name
      `);

      setActiveEmployees(empRes.rows.map((row: any) => ({
        id: row.id,
        name: row.name || "Unnamed",
        role: row.role,
        branch_name: row.branch_name || "Unassigned",
        status: "online"
      })));

      // Fetch branch stats
      const statsRes = await query(`
        SELECT 
          b.name, 
          COUNT(u.id) as emp_count
        FROM branches b
        LEFT JOIN users u ON b.id = u.assigned_branch_id AND u.is_active = true
        GROUP BY b.id, b.name
        ORDER BY emp_count DESC
      `);

      setBranchStats(statsRes.rows.map((row: any) => ({
        name: row.name,
        count: parseInt(row.emp_count)
      })));

    } catch (error) {
      console.error("Failed to fetch employee details:", error);
    } finally {
      setLoading(false);
    }
  };

  const totalActive = activeEmployees.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-warning" />
            Karyawan Aktif
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Branch Distribution */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {branchStats.map((branch) => (
              <div
                key={branch.name}
                className="p-3 bg-muted/50 rounded-lg text-center"
              >
                <p className="text-sm text-muted-foreground">{branch.name}</p>
                <p className="text-2xl font-bold">{branch.count}</p>
                <p className="text-xs text-muted-foreground">karyawan</p>
              </div>
            ))}
          </div>

          {/* Active Now */}
          <div className="p-4 bg-warning/10 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
              <p className="text-sm text-muted-foreground">Status Karyawan</p>
            </div>
            <p className="text-2xl font-bold">{totalActive} karyawan terdaftar aktif</p>
          </div>

          {/* Employee Table */}
          <div className="rounded-lg border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Karyawan</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Cabang</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-4">Loading...</TableCell>
                  </TableRow>
                ) : activeEmployees.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-4">Belum ada karyawan aktif</TableCell>
                  </TableRow>
                ) : (
                  activeEmployees.map((emp) => (
                    <TableRow key={emp.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-8 h-8">
                            <AvatarFallback>{emp.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium">{emp.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="secondary"
                          className={roleColors[emp.role] || "bg-muted text-muted-foreground"}
                        >
                          {emp.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="w-3 h-3 text-muted-foreground" />
                          {emp.branch_name}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${emp.status === 'online' ? 'bg-success' : 'bg-muted'}`} />
                          <span className="text-xs capitalize">{emp.status}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
