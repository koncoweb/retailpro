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

interface EmployeeDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const activeEmployees = [
  { id: 1, name: "Budi Santoso", role: "Store Manager", branch: "Jakarta", status: "online" },
  { id: 2, name: "Dewi Lestari", role: "Store Manager", branch: "Surabaya", status: "online" },
  { id: 3, name: "Andi Wijaya", role: "Cashier", branch: "Jakarta", status: "online" },
  { id: 4, name: "Sari Rahmawati", role: "Warehouse Staff", branch: "Bandung", status: "online" },
  { id: 5, name: "Maya Sari", role: "Cashier", branch: "Surabaya", status: "online" },
  { id: 6, name: "Rizky Pratama", role: "Cashier", branch: "Bandung", status: "break" },
  { id: 7, name: "Dina Putri", role: "Finance Staff", branch: "Jakarta", status: "online" },
  { id: 8, name: "Ahmad Fauzi", role: "Warehouse Staff", branch: "Medan", status: "online" },
];

const roleColors: Record<string, string> = {
  "Store Manager": "bg-primary/20 text-primary",
  "Cashier": "bg-success/20 text-success",
  "Warehouse Staff": "bg-info/20 text-info",
  "Finance Staff": "bg-warning/20 text-warning",
};

const branchStats = [
  { name: "Jakarta", count: 24 },
  { name: "Surabaya", count: 18 },
  { name: "Bandung", count: 12 },
  { name: "Medan", count: 10 },
];

export function EmployeeDetailModal({ open, onOpenChange }: EmployeeDetailModalProps) {
  const totalActive = activeEmployees.filter((e) => e.status === "online").length;

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
              <p className="text-sm text-muted-foreground">Sedang Aktif</p>
            </div>
            <p className="text-2xl font-bold">{totalActive} dari {activeEmployees.length} karyawan</p>
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
                {activeEmployees.map((emp) => (
                  <TableRow key={emp.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs">
                            {emp.name.split(" ").map((n) => n[0]).join("")}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{emp.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className={roleColors[emp.role] || "bg-muted"}>
                        {emp.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="flex items-center gap-1">
                      <Building2 className="w-3 h-3 text-muted-foreground" />
                      {emp.branch}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            emp.status === "online" ? "bg-success" : "bg-warning"
                          }`}
                        />
                        <span className="text-sm">
                          {emp.status === "online" ? "Online" : "Istirahat"}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
