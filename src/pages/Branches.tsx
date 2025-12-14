import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Search,
  Plus,
  MoreHorizontal,
  MapPin,
  Users,
  Package,
  TrendingUp,
  Building2,
  Phone,
  Mail,
  Edit,
  Trash2,
  Eye,
} from "lucide-react";

const branches = [
  {
    id: 1,
    name: "Cabang Jakarta Pusat",
    code: "JKT-01",
    address: "Jl. Thamrin No. 45, Jakarta Pusat",
    phone: "021-5555-1234",
    email: "jakarta@retailpro.id",
    manager: "Budi Santoso",
    employees: 24,
    products: 1250,
    status: "active",
    salesThisMonth: 156000000,
    salesTarget: 180000000,
  },
  {
    id: 2,
    name: "Cabang Surabaya",
    code: "SBY-01",
    address: "Jl. Basuki Rahmat No. 88, Surabaya",
    phone: "031-5555-5678",
    email: "surabaya@retailpro.id",
    manager: "Dewi Lestari",
    employees: 18,
    products: 980,
    status: "active",
    salesThisMonth: 98000000,
    salesTarget: 100000000,
  },
  {
    id: 3,
    name: "Cabang Bandung",
    code: "BDG-01",
    address: "Jl. Asia Afrika No. 120, Bandung",
    phone: "022-5555-9012",
    email: "bandung@retailpro.id",
    manager: "Andi Wijaya",
    employees: 12,
    products: 750,
    status: "active",
    salesThisMonth: 72000000,
    salesTarget: 80000000,
  },
  {
    id: 4,
    name: "Cabang Medan",
    code: "MDN-01",
    address: "Jl. Gatot Subroto No. 55, Medan",
    phone: "061-5555-3456",
    email: "medan@retailpro.id",
    manager: "Sari Rahmawati",
    employees: 10,
    products: 620,
    status: "active",
    salesThisMonth: 45000000,
    salesTarget: 60000000,
  },
  {
    id: 5,
    name: "Cabang Semarang",
    code: "SMG-01",
    address: "Jl. Pandanaran No. 77, Semarang",
    phone: "024-5555-7890",
    email: "semarang@retailpro.id",
    manager: "Rudi Hartono",
    employees: 8,
    products: 480,
    status: "inactive",
    salesThisMonth: 0,
    salesTarget: 50000000,
  },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Branches() {
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const filteredBranches = branches.filter(
    (branch) =>
      branch.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      branch.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalSales = branches.reduce((sum, b) => sum + b.salesThisMonth, 0);
  const totalEmployees = branches.reduce((sum, b) => sum + b.employees, 0);
  const totalProducts = branches.reduce((sum, b) => sum + b.products, 0);
  const activeBranches = branches.filter((b) => b.status === "active").length;

  return (
    <MainLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold">Manajemen Cabang</h1>
            <p className="text-muted-foreground mt-1">
              Kelola semua cabang dan pantau performanya
            </p>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="w-4 h-4" />
                Tambah Cabang
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader>
                <DialogTitle>Tambah Cabang Baru</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Nama Cabang</Label>
                  <Input id="name" placeholder="Cabang Yogyakarta" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="code">Kode Cabang</Label>
                    <Input id="code" placeholder="YGY-01" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="phone">No. Telepon</Label>
                    <Input id="phone" placeholder="0274-555-1234" />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="address">Alamat</Label>
                  <Input id="address" placeholder="Jl. Malioboro No. 100, Yogyakarta" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="yogyakarta@retailpro.id" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="manager">Manager</Label>
                  <Input id="manager" placeholder="Nama Manager" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Batal
                </Button>
                <Button onClick={() => setIsAddDialogOpen(false)}>Simpan</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-primary/10">
                <Building2 className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Cabang</p>
                <p className="text-2xl font-bold">{branches.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-success/10">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Penjualan</p>
                <p className="text-xl font-bold">{formatCurrency(totalSales)}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-info/10">
                <Users className="w-5 h-5 text-info" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Karyawan</p>
                <p className="text-2xl font-bold">{totalEmployees}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-lg bg-warning/10">
                <Package className="w-5 h-5 text-warning" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Produk</p>
                <p className="text-2xl font-bold">{totalProducts.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search & Filter */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Cari cabang..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Branches Table */}
        <div className="bg-card rounded-xl border overflow-hidden animate-fade-in">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cabang</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead className="text-center">Karyawan</TableHead>
                <TableHead className="text-center">Produk</TableHead>
                <TableHead className="text-right">Penjualan Bulan Ini</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBranches.map((branch) => {
                const progress = (branch.salesThisMonth / branch.salesTarget) * 100;
                return (
                  <TableRow key={branch.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                          <Building2 className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{branch.name}</p>
                          <p className="text-sm text-muted-foreground flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {branch.code}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{branch.manager}</p>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Phone className="w-3 h-3" />
                        {branch.phone}
                      </p>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-semibold">{branch.employees}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-semibold">{branch.products.toLocaleString()}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <p className="font-semibold">{formatCurrency(branch.salesThisMonth)}</p>
                      <p className="text-xs text-muted-foreground">
                        {progress.toFixed(0)}% dari target
                      </p>
                    </TableCell>
                    <TableCell className="text-center">
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
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </MainLayout>
  );
}
