import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BranchDetailModal } from "@/components/branches/BranchDetailModal";
import { toast } from "sonner";
import {
  Plus,
  MapPin,
  Users,
  Package,
  TrendingUp,
  Building2,
  Phone,
  Edit,
} from "lucide-react";

interface Branch {
  id: number;
  name: string;
  code: string;
  address: string;
  phone: string;
  email: string;
  manager: string;
  employees: number;
  products: number;
  status: "active" | "inactive";
  salesThisMonth: number;
  salesTarget: number;
}

const initialBranches: Branch[] = [
  { id: 1, name: "Cabang Jakarta Pusat", code: "JKT-01", address: "Jl. Thamrin No. 45, Jakarta Pusat", phone: "021-5555-1234", email: "jakarta@retailpro.id", manager: "Budi Santoso", employees: 24, products: 1250, status: "active", salesThisMonth: 156000000, salesTarget: 180000000 },
  { id: 2, name: "Cabang Surabaya", code: "SBY-01", address: "Jl. Basuki Rahmat No. 88, Surabaya", phone: "031-5555-5678", email: "surabaya@retailpro.id", manager: "Dewi Lestari", employees: 18, products: 980, status: "active", salesThisMonth: 98000000, salesTarget: 100000000 },
  { id: 3, name: "Cabang Bandung", code: "BDG-01", address: "Jl. Asia Afrika No. 120, Bandung", phone: "022-5555-9012", email: "bandung@retailpro.id", manager: "Andi Wijaya", employees: 12, products: 750, status: "active", salesThisMonth: 72000000, salesTarget: 80000000 },
  { id: 4, name: "Cabang Medan", code: "MDN-01", address: "Jl. Gatot Subroto No. 55, Medan", phone: "061-5555-3456", email: "medan@retailpro.id", manager: "Sari Rahmawati", employees: 10, products: 620, status: "active", salesThisMonth: 45000000, salesTarget: 60000000 },
  { id: 5, name: "Cabang Semarang", code: "SMG-01", address: "Jl. Pandanaran No. 77, Semarang", phone: "024-5555-7890", email: "semarang@retailpro.id", manager: "Rudi Hartono", employees: 8, products: 480, status: "inactive", salesThisMonth: 0, salesTarget: 50000000 },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

export default function Branches() {
  const [branches, setBranches] = useState<Branch[]>(initialBranches);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  
  // Form state
  const [formData, setFormData] = useState({
    name: "",
    code: "",
    address: "",
    phone: "",
    email: "",
    manager: "",
  });

  const totalSales = branches.reduce((sum, b) => sum + b.salesThisMonth, 0);
  const totalEmployees = branches.reduce((sum, b) => sum + b.employees, 0);
  const totalProducts = branches.reduce((sum, b) => sum + b.products, 0);
  const activeBranches = branches.filter(b => b.status === "active").length;

  const handleRowClick = (branch: Branch) => {
    setSelectedBranch(branch);
    setIsDetailOpen(true);
  };

  const handleToggleStatus = (e: React.MouseEvent, branchId: number) => {
    e.stopPropagation();
    setBranches(branches.map(b => {
      if (b.id === branchId) {
        const newStatus = b.status === "active" ? "inactive" : "active";
        toast.success(`Cabang ${b.name} ${newStatus === "active" ? "diaktifkan" : "dinonaktifkan"}`);
        return { ...b, status: newStatus };
      }
      return b;
    }));
  };

  const handleAddBranch = () => {
    if (!formData.name || !formData.code) {
      toast.error("Nama dan kode cabang wajib diisi");
      return;
    }

    const newBranch: Branch = {
      id: Date.now(),
      name: formData.name,
      code: formData.code,
      address: formData.address,
      phone: formData.phone,
      email: formData.email,
      manager: formData.manager,
      employees: 0,
      products: 0,
      status: "active",
      salesThisMonth: 0,
      salesTarget: 50000000,
    };

    setBranches([...branches, newBranch]);
    toast.success("Cabang baru berhasil ditambahkan");
    setIsAddDialogOpen(false);
    setFormData({ name: "", code: "", address: "", phone: "", email: "", manager: "" });
  };

  const handleEditBranch = (e: React.MouseEvent, branch: Branch) => {
    e.stopPropagation();
    setEditingBranch(branch);
    setFormData({
      name: branch.name,
      code: branch.code,
      address: branch.address,
      phone: branch.phone,
      email: branch.email,
      manager: branch.manager,
    });
  };

  const handleSaveEdit = () => {
    if (!editingBranch) return;

    setBranches(branches.map(b => {
      if (b.id === editingBranch.id) {
        return {
          ...b,
          name: formData.name,
          code: formData.code,
          address: formData.address,
          phone: formData.phone,
          email: formData.email,
          manager: formData.manager,
        };
      }
      return b;
    }));

    toast.success("Cabang berhasil diupdate");
    setEditingBranch(null);
    setFormData({ name: "", code: "", address: "", phone: "", email: "", manager: "" });
  };

  return (
    <MainLayout>
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Manajemen Cabang</h1>
            <p className="text-muted-foreground text-sm md:text-base mt-1">Kelola semua cabang dan pantau performanya</p>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 w-full sm:w-auto"><Plus className="w-4 h-4" />Tambah Cabang</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[500px]">
              <DialogHeader><DialogTitle>Tambah Cabang Baru</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label>Nama Cabang *</Label>
                  <Input 
                    placeholder="Cabang Yogyakarta" 
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Kode *</Label>
                    <Input 
                      placeholder="YGY-01" 
                      value={formData.code}
                      onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Telepon</Label>
                    <Input 
                      placeholder="0274-555-1234" 
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label>Alamat</Label>
                  <Input 
                    placeholder="Jl. Malioboro No. 100" 
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Email</Label>
                  <Input 
                    type="email" 
                    placeholder="yogyakarta@retailpro.id" 
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Manager</Label>
                  <Input 
                    placeholder="Nama Manager" 
                    value={formData.manager}
                    onChange={(e) => setFormData({ ...formData, manager: e.target.value })}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setIsAddDialogOpen(false)}>Batal</Button>
                <Button className="flex-1" onClick={handleAddBranch}>Simpan</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* Edit Dialog */}
        <Dialog open={!!editingBranch} onOpenChange={(open) => !open && setEditingBranch(null)}>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader><DialogTitle>Edit Cabang</DialogTitle></DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label>Nama Cabang *</Label>
                <Input 
                  placeholder="Cabang Yogyakarta" 
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label>Kode *</Label>
                  <Input 
                    placeholder="YGY-01" 
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Telepon</Label>
                  <Input 
                    placeholder="0274-555-1234" 
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Alamat</Label>
                <Input 
                  placeholder="Jl. Malioboro No. 100" 
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Email</Label>
                <Input 
                  type="email" 
                  placeholder="yogyakarta@retailpro.id" 
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Manager</Label>
                <Input 
                  placeholder="Nama Manager" 
                  value={formData.manager}
                  onChange={(e) => setFormData({ ...formData, manager: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setEditingBranch(null)}>Batal</Button>
              <Button className="flex-1" onClick={handleSaveEdit}>Simpan</Button>
            </div>
          </DialogContent>
        </Dialog>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className="bg-card rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-2.5 rounded-lg bg-primary/10">
                <Building2 className="w-4 h-4 md:w-5 md:h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Total Cabang</p>
                <p className="text-xl md:text-2xl font-bold">{branches.length}</p>
                <p className="text-xs text-success">{activeBranches} aktif</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-2.5 rounded-lg bg-success/10">
                <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-success" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Total Penjualan</p>
                <p className="text-lg md:text-xl font-bold">{formatCurrency(totalSales)}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-2.5 rounded-lg bg-info/10">
                <Users className="w-4 h-4 md:w-5 md:h-5 text-info" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Total Karyawan</p>
                <p className="text-xl md:text-2xl font-bold">{totalEmployees}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-2.5 rounded-lg bg-warning/10">
                <Package className="w-4 h-4 md:w-5 md:h-5 text-warning" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Total Produk</p>
                <p className="text-xl md:text-2xl font-bold">{totalProducts.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cabang</TableHead>
                <TableHead className="hidden md:table-cell">Manager</TableHead>
                <TableHead className="text-center">Karyawan</TableHead>
                <TableHead className="text-center hidden sm:table-cell">Produk</TableHead>
                <TableHead className="text-right hidden lg:table-cell">Penjualan</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center w-24">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.map((branch) => (
                <TableRow key={branch.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleRowClick(branch)}>
                  <TableCell>
                    <div className="flex items-center gap-2 md:gap-3">
                      <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Building2 className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-medium text-sm md:text-base">{branch.name}</p>
                        <p className="text-xs md:text-sm text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3 h-3" />{branch.code}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <p className="font-medium">{branch.manager}</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3 h-3" />{branch.phone}
                    </p>
                  </TableCell>
                  <TableCell className="text-center font-semibold">{branch.employees}</TableCell>
                  <TableCell className="text-center font-semibold hidden sm:table-cell">{branch.products.toLocaleString()}</TableCell>
                  <TableCell className="text-right hidden lg:table-cell">
                    <p className="font-semibold">{formatCurrency(branch.salesThisMonth)}</p>
                    <p className="text-xs text-muted-foreground">{((branch.salesThisMonth / branch.salesTarget) * 100).toFixed(0)}% dari target</p>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={branch.status === "active"}
                        onCheckedChange={() => {}}
                        onClick={(e) => handleToggleStatus(e, branch.id)}
                      />
                      <Badge 
                        variant={branch.status === "active" ? "default" : "secondary"} 
                        className={branch.status === "active" ? "bg-success/20 text-success hover:bg-success/30" : ""}
                      >
                        {branch.status === "active" ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Button variant="ghost" size="icon" onClick={(e) => handleEditBranch(e, branch)}>
                      <Edit className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <BranchDetailModal open={isDetailOpen} onOpenChange={setIsDetailOpen} branch={selectedBranch} />
    </MainLayout>
  );
}
