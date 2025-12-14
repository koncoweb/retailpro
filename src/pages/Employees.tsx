import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
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
  Eye,
  Mail,
  Phone,
} from "lucide-react";

const employees = [
  {
    id: 1,
    name: "Budi Santoso",
    email: "budi.santoso@retailpro.id",
    phone: "0812-3456-7890",
    position: "Store Manager",
    department: "Operations",
    branch: "Jakarta",
    status: "active",
    joinDate: "2020-03-15",
    salary: 12000000,
    avatar: null,
  },
  {
    id: 2,
    name: "Dewi Lestari",
    email: "dewi.lestari@retailpro.id",
    phone: "0813-5678-9012",
    position: "Store Manager",
    department: "Operations",
    branch: "Surabaya",
    status: "active",
    joinDate: "2019-07-22",
    salary: 11500000,
    avatar: null,
  },
  {
    id: 3,
    name: "Andi Wijaya",
    email: "andi.wijaya@retailpro.id",
    phone: "0814-7890-1234",
    position: "Cashier",
    department: "Sales",
    branch: "Jakarta",
    status: "active",
    joinDate: "2022-01-10",
    salary: 5500000,
    avatar: null,
  },
  {
    id: 4,
    name: "Sari Rahmawati",
    email: "sari.rahmawati@retailpro.id",
    phone: "0815-9012-3456",
    position: "Warehouse Staff",
    department: "Warehouse",
    branch: "Bandung",
    status: "active",
    joinDate: "2021-05-18",
    salary: 5000000,
    avatar: null,
  },
  {
    id: 5,
    name: "Rudi Hartono",
    email: "rudi.hartono@retailpro.id",
    phone: "0816-1234-5678",
    position: "Finance Staff",
    department: "Finance",
    branch: "Jakarta",
    status: "inactive",
    joinDate: "2020-11-05",
    salary: 7500000,
    avatar: null,
  },
  {
    id: 6,
    name: "Maya Sari",
    email: "maya.sari@retailpro.id",
    phone: "0817-3456-7890",
    position: "Cashier",
    department: "Sales",
    branch: "Surabaya",
    status: "active",
    joinDate: "2023-02-28",
    salary: 5200000,
    avatar: null,
  },
];

const departments = ["Semua", "Operations", "Sales", "Warehouse", "Finance", "HR"];
const branches = ["Semua", "Jakarta", "Surabaya", "Bandung", "Medan"];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(value);
}

export default function Employees() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDepartment, setSelectedDepartment] = useState("Semua");
  const [selectedBranch, setSelectedBranch] = useState("Semua");

  const filteredEmployees = employees.filter((emp) => {
    const matchesSearch =
      emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDepartment =
      selectedDepartment === "Semua" || emp.department === selectedDepartment;
    const matchesBranch = selectedBranch === "Semua" || emp.branch === selectedBranch;
    return matchesSearch && matchesDepartment && matchesBranch;
  });

  const totalEmployees = employees.length;
  const activeEmployees = employees.filter((e) => e.status === "active").length;
  const totalSalary = employees.reduce((sum, e) => sum + e.salary, 0);

  return (
    <MainLayout>
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
            <Button className="gap-2">
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
                <p className="text-2xl font-bold text-success">{activeEmployees}</p>
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
                  {totalEmployees - activeEmployees}
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
                <p className="text-sm text-muted-foreground">Total Gaji/Bulan</p>
                <p className="text-xl font-bold">{formatCurrency(totalSalary)}</p>
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
          <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Departemen" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((dept) => (
                <SelectItem key={dept} value={dept}>
                  {dept}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={selectedBranch} onValueChange={setSelectedBranch}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Cabang" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((branch) => (
                <SelectItem key={branch} value={branch}>
                  {branch}
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
                <TableHead>Posisi</TableHead>
                <TableHead>Cabang</TableHead>
                <TableHead>Departemen</TableHead>
                <TableHead className="text-right">Gaji</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEmployees.map((emp) => (
                <TableRow key={emp.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={emp.avatar || undefined} />
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {emp.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium">{emp.name}</p>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Mail className="w-3 h-3" />
                          {emp.email}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{emp.position}</p>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Phone className="w-3 h-3" />
                      {emp.phone}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{emp.branch}</Badge>
                  </TableCell>
                  <TableCell>{emp.department}</TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(emp.salary)}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant={emp.status === "active" ? "default" : "secondary"}
                      className={
                        emp.status === "active"
                          ? "bg-success/20 text-success hover:bg-success/30"
                          : ""
                      }
                    >
                      {emp.status === "active" ? "Aktif" : "Tidak Aktif"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Eye className="w-4 h-4 mr-2" />
                          Lihat Detail
                        </DropdownMenuItem>
                        <DropdownMenuItem>
                          <Edit className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-destructive">
                          <Trash2 className="w-4 h-4 mr-2" />
                          Hapus
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </MainLayout>
  );
}
