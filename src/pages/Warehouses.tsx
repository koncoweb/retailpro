import { useState, useEffect } from "react";
import { BackOfficeLayout } from "@/components/layout/BackOfficeLayout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Warehouse as WarehouseIcon, Package, Building2, Edit, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { query, runTransaction } from "@/lib/db";

type WarehouseType = "central" | "regional" | "store";

const WAREHOUSE_TYPE_LABEL: Record<WarehouseType, string> = {
  central: "Gudang Pusat (DC)",
  regional: "Gudang Regional",
  store: "Gudang Cabang",
};

interface WarehouseRow {
  id: string;
  name: string;
  code: string | null;
  type: WarehouseType;
  branch_id: string | null;
  branch_name: string | null;
  address: string | null;
  status: "active" | "inactive";
  is_default: number;
  mapped_branches: number;
  active_batches: number;
  total_stock: number;
}

interface BranchOption {
  id: string;
  name: string;
}

interface MappingRow {
  warehouse_id: string;
  branch_id: string;
}

const WAREHOUSE_LIST_SQL = `
  SELECT
    w.id, w.name, w.code, w.type, w.branch_id, w.address, w.status, w.is_default,
    b.name as branch_name,
    (SELECT COUNT(*) FROM branch_warehouses bw WHERE bw.warehouse_id = w.id) as mapped_branches,
    (SELECT COUNT(*) FROM product_batches pb
      WHERE pb.warehouse_id = w.id AND pb.quantity_current > 0) as active_batches,
    (SELECT COALESCE(SUM(pb.quantity_current), 0) FROM product_batches pb
      WHERE pb.warehouse_id = w.id) as total_stock
  FROM warehouses w
  LEFT JOIN branches b ON b.id = w.branch_id
  ORDER BY w.is_default DESC, w.name ASC
`;

const emptyForm = {
  name: "",
  code: "",
  type: "store" as WarehouseType,
  /** Empty string = shared, company-wide warehouse. */
  branchId: "",
  address: "",
  mappedBranchIds: [] as string[],
};

/**
 * Warehouses are the stock-keeping locations. A branch sells, a warehouse
 * holds; `branch_warehouses` decides which stockrooms a store may sell from.
 * The defaults are 1 branch → 1 backroom, but a company-wide DC can be mapped
 * to every branch so many-branch/one-warehouse also works.
 */
export default function Warehouses() {
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [mappings, setMappings] = useState<MappingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<WarehouseRow | null>(null);
  const [formData, setFormData] = useState({ ...emptyForm });

  const fetchData = async () => {
    try {
      setIsLoading(true);
      const [warehouseRes, branchRes, mappingRes] = await Promise.all([
        query(WAREHOUSE_LIST_SQL),
        query(`SELECT id, name FROM branches ORDER BY is_headquarters DESC, name ASC`),
        query(`SELECT warehouse_id, branch_id FROM branch_warehouses`),
      ]);
      setWarehouses(warehouseRes.rows as unknown as WarehouseRow[]);
      setBranches(branchRes.rows as unknown as BranchOption[]);
      setMappings(mappingRes.rows as unknown as MappingRow[]);
    } catch (error) {
      console.error("Failed to fetch warehouses:", error);
      toast.error("Gagal mengambil data gudang");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setFormData({ ...emptyForm });
    setIsDialogOpen(true);
  };

  const openEdit = (warehouse: WarehouseRow) => {
    setEditing(warehouse);
    setFormData({
      name: warehouse.name,
      code: warehouse.code ?? "",
      type: warehouse.type,
      branchId: warehouse.branch_id ?? "",
      address: warehouse.address ?? "",
      mappedBranchIds: mappings
        .filter((mapping) => mapping.warehouse_id === warehouse.id)
        .map((mapping) => mapping.branch_id),
    });
    setIsDialogOpen(true);
  };

  const toggleBranch = (branchId: string, checked: boolean) => {
    setFormData((prev) => ({
      ...prev,
      mappedBranchIds: checked
        ? Array.from(new Set([...prev.mappedBranchIds, branchId]))
        : prev.mappedBranchIds.filter((id) => id !== branchId),
    }));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Nama gudang wajib diisi");
      return;
    }

    const owningBranchId = formData.branchId || null;
    // The owning branch must also be a fulfilment source, otherwise a store
    // could own stock it is not allowed to sell from.
    const mappedBranchIds = Array.from(
      new Set(owningBranchId ? [...formData.mappedBranchIds, owningBranchId] : formData.mappedBranchIds)
    );

    try {
      await runTransaction(async (tx) => {
        let warehouseId: string;

        if (editing) {
          warehouseId = editing.id;
          await tx.query(
            `UPDATE warehouses
                SET name = $1, code = $2, type = $3, branch_id = $4, address = $5
              WHERE id = $6`,
            [
              formData.name.trim(),
              formData.code.trim() || null,
              formData.type,
              owningBranchId,
              formData.address.trim() || null,
              warehouseId,
            ]
          );
          // Reconcile the fulfilment map: unmapped stores stop selling from
          // this stockroom, newly mapped ones start.
          const placeholders = mappedBranchIds.map((_, index) => `$${index + 2}`).join(",");
          await tx.query(
            `DELETE FROM branch_warehouses
              WHERE warehouse_id = $1 AND branch_id NOT IN (${placeholders || "''"})`,
            [warehouseId, ...mappedBranchIds]
          );
        } else {
          const created = await tx.query<{ id: string }>(
            `INSERT INTO warehouses (name, code, type, branch_id, address, status, is_default)
             VALUES ($1, $2, $3, $4, $5, 'active',
                     (SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
                        FROM warehouses WHERE is_default = 1))
             RETURNING id`,
            [
              formData.name.trim(),
              formData.code.trim() || null,
              formData.type,
              owningBranchId,
              formData.address.trim() || null,
            ]
          );
          warehouseId = created.rows[0].id;
        }

        for (const branchId of mappedBranchIds) {
          await tx.query(
            `INSERT OR IGNORE INTO branch_warehouses (branch_id, warehouse_id, is_default, priority)
             VALUES ($1, $2, $3, $4)`,
            [branchId, warehouseId, branchId === owningBranchId ? 1 : 0, branchId === owningBranchId ? 1 : 2]
          );
        }

        // Keep exactly one default for each owning store.
        if (owningBranchId) {
          await tx.query(
            `UPDATE branch_warehouses
                SET is_default = CASE WHEN warehouse_id = $1 THEN 1 ELSE 0 END,
                    priority   = CASE WHEN warehouse_id = $1 THEN 1 ELSE priority + 1 END
              WHERE branch_id = $2`,
            [warehouseId, owningBranchId]
          );
        }
      });

      toast.success(editing ? "Gudang berhasil diperbarui" : "Gudang baru berhasil ditambahkan");
      setIsDialogOpen(false);
      setFormData({ ...emptyForm });
      setEditing(null);
      fetchData();
    } catch (error) {
      console.error("Save warehouse failed:", error);
      toast.error(
        "Gagal menyimpan gudang: " + (error instanceof Error ? error.message : "Unknown error")
      );
    }
  };

  const handleToggleStatus = async (warehouse: WarehouseRow) => {
    const nextStatus = warehouse.status === "active" ? "inactive" : "active";
    try {
      await query(`UPDATE warehouses SET status = $1 WHERE id = $2`, [nextStatus, warehouse.id]);
      toast.success(nextStatus === "active" ? "Gudang diaktifkan" : "Gudang dinonaktifkan");
      fetchData();
    } catch (error) {
      console.error("Toggle warehouse status failed:", error);
      toast.error("Gagal mengubah status gudang");
    }
  };

  const branchNamesFor = (warehouseId: string) =>
    mappings
      .filter((mapping) => mapping.warehouse_id === warehouseId)
      .map((mapping) => branches.find((branch) => branch.id === mapping.branch_id)?.name)
      .filter(Boolean) as string[];

  const totalStock = warehouses.reduce((sum, warehouse) => sum + Number(warehouse.total_stock || 0), 0);

  return (
    <BackOfficeLayout>
      <div className="space-y-4 md:space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Manajemen Gudang</h1>
            <p className="text-muted-foreground text-sm md:text-base mt-1">
              Gudang menyimpan stok; cabang menjualnya. Satu gudang bisa melayani banyak cabang.
            </p>
          </div>
          <Button className="gap-2 w-full sm:w-auto" onClick={openCreate}>
            <Plus className="w-4 h-4" />
            Tambah Gudang
          </Button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <div className="bg-card rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-2.5 rounded-lg bg-primary/10">
                <WarehouseIcon className="w-4 h-4 md:w-5 md:h-5 text-primary" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Total Gudang</p>
                <p className="text-xl md:text-2xl font-bold">{warehouses.length}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-2.5 rounded-lg bg-info/10">
                <Building2 className="w-4 h-4 md:w-5 md:h-5 text-info" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Gudang Bersama</p>
                <p className="text-xl md:text-2xl font-bold">
                  {warehouses.filter((warehouse) => !warehouse.branch_id).length}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-2.5 rounded-lg bg-success/10">
                <Package className="w-4 h-4 md:w-5 md:h-5 text-success" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Total Unit Stok</p>
                <p className="text-xl md:text-2xl font-bold">{totalStock.toLocaleString("id-ID")}</p>
              </div>
            </div>
          </div>
          <div className="bg-card rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="p-2 md:p-2.5 rounded-lg bg-warning/10">
                <Building2 className="w-4 h-4 md:w-5 md:h-5 text-warning" />
              </div>
              <div>
                <p className="text-xs md:text-sm text-muted-foreground">Cabang Terlayani</p>
                <p className="text-xl md:text-2xl font-bold">
                  {new Set(mappings.map((mapping) => mapping.branch_id)).size}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-card rounded-xl border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Gudang</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Pemilik</TableHead>
                <TableHead className="hidden md:table-cell">Melayani Cabang</TableHead>
                <TableHead className="text-center">SKU Aktif</TableHead>
                <TableHead className="text-center hidden sm:table-cell">Stok</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-center w-20">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
                  </TableCell>
                </TableRow>
              ) : warehouses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    Belum ada gudang. Tambahkan gudang pertama Anda.
                  </TableCell>
                </TableRow>
              ) : (
                warehouses.map((warehouse) => {
                  const servedBranches = branchNamesFor(warehouse.id);
                  return (
                    <TableRow key={warehouse.id}>
                      <TableCell>
                        <div className="flex items-center gap-2 md:gap-3">
                          <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                            <WarehouseIcon className="w-4 h-4 md:w-5 md:h-5 text-primary" />
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-medium text-sm md:text-base">{warehouse.name}</p>
                              {Number(warehouse.is_default) === 1 && (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary">
                                  Utama
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs md:text-sm text-muted-foreground">
                              {warehouse.code || "Tanpa kode"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {WAREHOUSE_TYPE_LABEL[warehouse.type] ?? warehouse.type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm">{warehouse.branch_name ?? "Bersama (perusahaan)"}</p>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <p className="text-sm text-muted-foreground">
                          {servedBranches.length === 0
                            ? "Belum dipetakan"
                            : servedBranches.slice(0, 3).join(", ") +
                              (servedBranches.length > 3 ? ` +${servedBranches.length - 3}` : "")}
                        </p>
                      </TableCell>
                      <TableCell className="text-center font-semibold">{warehouse.active_batches}</TableCell>
                      <TableCell className="text-center hidden sm:table-cell font-semibold">
                        {Number(warehouse.total_stock || 0).toLocaleString("id-ID")}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Switch
                            checked={warehouse.status === "active"}
                            onCheckedChange={() => handleToggleStatus(warehouse)}
                          />
                          <Badge
                            variant={warehouse.status === "active" ? "default" : "secondary"}
                            className={warehouse.status === "active" ? "bg-success/20 text-success hover:bg-success/30" : ""}
                          >
                            {warehouse.status === "active" ? "Aktif" : "Nonaktif"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(warehouse)}>
                          <Edit className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Gudang" : "Tambah Gudang Baru"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Nama Gudang *</Label>
              <Input
                placeholder="Gudang Pusat Cimahi"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Kode</Label>
                <Input
                  placeholder="GD-PST-01"
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label>Tipe Gudang</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value) => setFormData({ ...formData, type: value as WarehouseType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(WAREHOUSE_TYPE_LABEL) as WarehouseType[]).map((type) => (
                      <SelectItem key={type} value={type}>{WAREHOUSE_TYPE_LABEL[type]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label>Pemilik</Label>
              <Select
                value={formData.branchId || "shared"}
                onValueChange={(value) =>
                  setFormData({ ...formData, branchId: value === "shared" ? "" : value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="shared">Bersama (perusahaan)</SelectItem>
                  {branches.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>{branch.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pemilik dipakai untuk laporan; gudang bersama bisa melayani semua cabang.
              </p>
            </div>

            <div className="grid gap-2">
              <Label>Alamat</Label>
              <Input
                placeholder="Jl. Raya Cimahi No. 12"
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>

            <div className="border rounded-md p-4 space-y-3 bg-muted/20">
              <div>
                <Label className="font-medium">Cabang yang Dilayani</Label>
                <p className="text-xs text-muted-foreground">
                  Cabang hanya bisa menjual stok dari gudang yang dipetakan ke sini.
                </p>
              </div>
              <div className="grid gap-2">
                {branches.map((branch) => (
                  <div key={branch.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`map-${branch.id}`}
                      checked={formData.mappedBranchIds.includes(branch.id)}
                      onCheckedChange={(checked) => toggleBranch(branch.id, checked as boolean)}
                    />
                    <Label htmlFor={`map-${branch.id}`} className="font-normal">
                      {branch.name}
                      {branch.id === formData.branchId && (
                        <span className="text-xs text-muted-foreground"> (pemilik)</span>
                      )}
                    </Label>
                  </div>
                ))}
                {branches.length === 0 && (
                  <p className="text-sm text-muted-foreground">Belum ada cabang.</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => setIsDialogOpen(false)}>
              Batal
            </Button>
            <Button className="flex-1" onClick={handleSave}>
              {editing ? "Simpan Perubahan" : "Simpan"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </BackOfficeLayout>
  );
}
