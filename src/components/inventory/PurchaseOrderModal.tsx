import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Package,
  Plus,
  Trash2,
  AlertTriangle,
  ShoppingCart,
  Check,
  ChevronsUpDown,
  Info,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { query } from "@/lib/db";
import { formatCurrency } from "@/lib/formatters";
import { isRackWarehouse, warehouseLabel, type WarehouseOption } from "@/lib/warehouse";
import { isoToday, validatePurchaseOrder } from "@/lib/procurement";

import { ProductUnit } from "@/components/inventory/AddProductModal";
import { variantLabel, type VariantAttributes } from "@/lib/variants";

/**
 * One sellable variant of a product. A product with a flavour group has one of
 * these per flavour, each with its own SKU and its own packs.
 */
export interface ProductVariantOption {
  id: string;
  sku: string;
  attributes: VariantAttributes;
  /** Buy price of the base pack. */
  cost: number;
  price: number;
  units: ProductUnit[];
}

interface Product {
  id: string;
  sku: string;
  name: string;
  stock: number;
  minStock: number;
  cost: number;
  supplier: string;
  /** Main vendor of the product, plus every vendor linked through vendor_products. */
  supplierId?: string | null;
  vendorIds?: string[];
  /**
   * `vendor_products.last_cost` keyed by vendor, so the order starts from the
   * price this vendor last charged instead of the product's average cost.
   */
  vendorCosts?: Record<string, number>;
  warehouses: Record<string, number>;
  units: ProductUnit[];
  /** Empty or missing means the product has a single Default variant. */
  variants?: ProductVariantOption[];
}

/** The panel hands over the same product rows the inventory table already holds. */
export type PurchaseOrderProduct = Product;

/** Vendor master fields the purchasing screen needs. */
export interface VendorOption {
  id: string;
  name: string;
  code?: string | null;
  payment_terms_days?: number;
  lead_time_days?: number;
}

export interface PurchaseOrderDraftLine {
  productId: string;
  productName: string;
  sku: string;
  /** `product_variants.id`; null for a product that has no variants. */
  variantId: string | null;
  /** "Susu 250ml", stored so the line still reads after a variant renames. */
  variantName?: string;
  quantity: number;
  unitName: string;
  conversionFactor: number;
  unitCost: number;
  subtotal: number;
}

/** Exactly what the editor produces: a draft. Nothing has left the building. */
export interface PurchaseOrderDraftValues {
  supplierId: string;
  supplierName: string;
  /** Copied from the vendor so a later edit to the vendor cannot move old bills. */
  paymentTermsDays: number;
  destinationWarehouseId: string;
  expectedDate: string;
  notes: string;
  items: PurchaseOrderDraftLine[];
  totalAmount: number;
}

interface PurchaseOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  /** Active warehouses only — the caller filters with `activeWarehouses()`. */
  warehouses: WarehouseOption[];
  vendors: VendorOption[];
  /** Preselected destination, normally the gudang this branch orders from. */
  defaultWarehouseId?: string | null;
  /** Edit mode: an existing draft, or null to create a new one. */
  initialDraft?: PurchaseOrderDraftValues | null;
  /**
   * Persist the draft. Rejecting keeps the dialog open and shows the message;
   * resolving lets the dialog close. The caller owns the success toast.
   */
  onSubmit: (draft: PurchaseOrderDraftValues, options: { submit: boolean }) => Promise<void>;
}

const BASE_UNIT_FALLBACK = "Pcs";

/** The packs being ordered: the chosen variant's own, or the product's own. */
function packsOf(product: Product, variant: ProductVariantOption | null): ProductUnit[] {
  if (variant) return variant.units ?? [];
  return product.units ?? [];
}

/** The pack a variant is stocked in, used as the default line unit. */
function baseUnitOf(packs: ProductUnit[]): { name: string; conversionFactor: number } {
  const base = packs.find((unit) => Number(unit.conversion_factor) === 1);
  return { name: base?.name ?? BASE_UNIT_FALLBACK, conversionFactor: 1 };
}

/** `0,5` typed as "0,5" still means half a kilogram. */
function parseNumber(value: string): number {
  return Number(value.replace(",", "."));
}

function hasTooManyDecimals(value: number): boolean {
  return Math.round(value * 1000) !== value * 1000;
}

/** One agreed buy price, flattened for lookup while the buyer types. */
interface AgreedPrice {
  buyPrice: number;
  minQty: number;
}

/**
 * Price list rows are keyed by (variant, pack), not by product: a carton and a
 * piece of the same variant carry two separate agreements.
 */
function priceKey(variantId: string | null | undefined, unitName: string): string {
  return `${variantId ?? ""}|${unitName}`;
}

export function PurchaseOrderModal({
  open,
  onOpenChange,
  products,
  warehouses,
  vendors,
  defaultWarehouseId,
  initialDraft,
  onSubmit,
}: PurchaseOrderModalProps) {
  const [destinationWarehouse, setDestinationWarehouse] = useState("");
  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedVariant, setSelectedVariant] = useState("");
  const [selectedUnit, setSelectedUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [items, setItems] = useState<PurchaseOrderDraftLine[]>([]);
  const [notes, setNotes] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [selectedVendor, setSelectedVendor] = useState("");
  const [openCombobox, setOpenCombobox] = useState(false);
  const [saving, setSaving] = useState<"draft" | "submit" | null>(null);
  const [agreedPrices, setAgreedPrices] = useState<Record<string, AgreedPrice>>({});

  const lowStockProducts = products.filter((product) => product.stock <= product.minStock);

  const vendorOf = (id: string) => vendors.find((vendor) => vendor.id === id) ?? null;

  /** Does this product come from the selected vendor (main vendor or linked)? */
  const belongsToVendor = (product: Product, vendorId: string) =>
    product.supplierId === vendorId || (product.vendorIds ?? []).includes(vendorId);

  const filteredProducts = selectedVendor
    ? products.filter((product) => belongsToVendor(product, selectedVendor))
    : products;

  const selectedProductObj = products.find((product) => product.id === selectedProduct);
  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === destinationWarehouse) ?? null;

  /** What this vendor charges for the product's base unit. */
  const baseCostOf = (product: Product): number => {
    const lastCost = selectedVendor ? product.vendorCosts?.[selectedVendor] : undefined;
    return Number(lastCost ?? product.cost ?? 0);
  };

  /** The variants the picker offers; a product without any is a single line. */
  const variantOptions: ProductVariantOption[] = selectedProductObj?.variants ?? [];
  const selectedVariantObj =
    variantOptions.find((variant) => variant.id === selectedVariant) ?? null;

  /**
   * Unit price for the chosen pack.
   *
   * Precedence is the agreed price list, then the pack's own buy price, then
   * the vendor's last base cost x factor. The pricelist wins because that is
   * the whole point of it: the owner negotiated it in the vendor module, so a
   * buyer must not silently re-derive a different number from the product form.
   * The intermediate step also matters: a carton is NOT automatically factor x
   * the piece price, and assuming it would throw the volume discount away.
   */
  const unitCostOf = (
    product: Product,
    variant: ProductVariantOption | null,
    unitName: string
  ): number => {
    const agreed = agreedPrices[priceKey(variant?.id, unitName)];
    if (agreed && agreed.buyPrice > 0) return Math.round(agreed.buyPrice);
    const unit = packsOf(product, variant).find((candidate) => candidate.name === unitName);
    const factor = Number(unit?.conversion_factor ?? 1) || 1;
    const packCost = Number(unit?.cost ?? 0);
    if (packCost > 0) return Math.round(packCost);
    return Math.round(baseCostOf(product) * factor);
  };

  /**
   * The price this vendor agreed for the selection, so the buyer can see when
   * what they are typing departs from it. Loaded here rather than passed in:
   * the price list belongs to the vendor module and changes independently of
   * any product row the caller happens to hold.
   */
  useEffect(() => {
    let cancelled = false;
    if (!open || !selectedVendor) {
      setAgreedPrices({});
      return;
    }

    query<{ variant_id: string; unit_name: string; buy_price: number; min_qty: number }>(
      `SELECT variant_id, unit_name, buy_price, min_qty
         FROM vendor_price_list
        WHERE vendor_id = $1 AND status = 'active'`,
      [selectedVendor]
    )
      .then((res) => {
        if (cancelled) return;
        const next: Record<string, AgreedPrice> = {};
        for (const row of res.rows) {
          next[priceKey(row.variant_id, row.unit_name)] = {
            buyPrice: Number(row.buy_price ?? 0),
            minQty: Number(row.min_qty ?? 1) || 1,
          };
        }
        setAgreedPrices(next);
      })
      .catch((error) => {
        // A missing price list must not block ordering: fall back to the
        // product's own cost, which is what every screen did before it existed.
        console.error("Failed to load vendor price list:", error);
        if (!cancelled) setAgreedPrices({});
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedVendor]);

  const agreedForSelection = agreedPrices[priceKey(selectedVariantObj?.id, selectedUnit)];

  // The list arrives after the product picker already filled in a cost, so
  // re-apply it once known; otherwise the buyer starts from a stale number.
  useEffect(() => {
    if (!selectedProductObj || !selectedUnit) return;
    if (!agreedPrices[priceKey(selectedVariantObj?.id, selectedUnit)]) return;
    setCostPrice(String(unitCostOf(selectedProductObj, selectedVariantObj, selectedUnit)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agreedPrices]);

  // Re-seed on every open: a dialog that keeps the previous order's lines is how
  // duplicate purchase orders get created by accident.
  useEffect(() => {
    if (!open) return;
    if (initialDraft) {
      setSelectedVendor(initialDraft.supplierId);
      setDestinationWarehouse(initialDraft.destinationWarehouseId);
      setExpectedDate(initialDraft.expectedDate);
      setNotes(initialDraft.notes);
      setItems(initialDraft.items);
    } else {
      setSelectedVendor("");
      setDestinationWarehouse(defaultWarehouseId ?? "");
      setExpectedDate("");
      setNotes("");
      setItems([]);
    }
    setSelectedProduct("");
    setSelectedVariant("");
    setSelectedUnit("");
    setQuantity("");
    setCostPrice("");
    setSaving(null);
  }, [open, initialDraft, defaultWarehouseId]);

  const totalAmount = useMemo(
    () => items.reduce((sum, item) => sum + item.subtotal, 0),
    [items]
  );

  const unitOptions = useMemo(() => {
    const packs = selectedProductObj ? packsOf(selectedProductObj, selectedVariantObj) : [];
    const names = packs.map((unit) => unit.name);
    const base = baseUnitOf(packs).name;
    return Array.from(new Set([base, ...names]));
  }, [selectedProductObj, selectedVariantObj]);

  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product.id);
    // A product with variants cannot be ordered without saying which one.
    const variants = product.variants ?? [];
    const firstVariant = variants.length > 0 ? variants[0] : null;
    setSelectedVariant(firstVariant?.id ?? "");
    const base = baseUnitOf(packsOf(product, firstVariant));
    setSelectedUnit(base.name);
    setCostPrice(String(unitCostOf(product, firstVariant, base.name)));
    setOpenCombobox(false);
  };

  const handleSelectVariant = (variantId: string) => {
    setSelectedVariant(variantId);
    if (!selectedProductObj) return;
    const variant = variantOptions.find((candidate) => candidate.id === variantId) ?? null;
    const base = baseUnitOf(packsOf(selectedProductObj, variant));
    setSelectedUnit(base.name);
    setCostPrice(String(unitCostOf(selectedProductObj, variant, base.name)));
  };

  const handleSelectUnit = (unitName: string) => {
    setSelectedUnit(unitName);
    if (selectedProductObj) {
      setCostPrice(String(unitCostOf(selectedProductObj, selectedVariantObj, unitName)));
    }
  };

  const handleAddItem = () => {
    if (!selectedProductObj) {
      toast.error("Pilih produk terlebih dahulu");
      return;
    }

    const qty = parseNumber(quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error("Jumlah harus lebih dari 0");
      return;
    }
    if (hasTooManyDecimals(qty)) {
      toast.error("Jumlah maksimal 3 angka di belakang koma");
      return;
    }

    const unitName = selectedUnit || baseUnitOf(packsOf(selectedProductObj, selectedVariantObj)).name;
    const unit = packsOf(selectedProductObj, selectedVariantObj).find(
      (candidate) => candidate.name === unitName
    );
    const conversionFactor = Number(unit?.conversion_factor ?? 1) || 1;
    const cost = costPrice.trim()
      ? parseNumber(costPrice)
      : unitCostOf(selectedProductObj, selectedVariantObj, unitName);
    if (!Number.isFinite(cost) || cost < 0) {
      toast.error("Harga satuan tidak valid");
      return;
    }

    const variantId = selectedVariantObj?.id ?? null;
    const existing = items.findIndex(
      (item) =>
        item.productId === selectedProductObj.id &&
        (item.variantId ?? null) === variantId &&
        item.unitName === unitName
    );
    if (existing >= 0) {
      const next = [...items];
      const merged = next[existing].quantity + qty;
      next[existing] = {
        ...next[existing],
        quantity: merged,
        unitCost: cost,
        subtotal: Math.round(merged * cost),
      };
      setItems(next);
    } else {
      setItems([
        ...items,
        {
          productId: selectedProductObj.id,
          productName: selectedProductObj.name,
          sku: selectedVariantObj?.sku ?? selectedProductObj.sku,
          variantId,
          variantName: selectedVariantObj ? variantLabel(selectedVariantObj.attributes) : undefined,
          quantity: qty,
          unitName,
          conversionFactor,
          unitCost: cost,
          subtotal: Math.round(qty * cost),
        },
      ]);
    }

    setSelectedProduct("");
    setSelectedVariant("");
    setSelectedUnit("");
    setQuantity("");
    setCostPrice("");
  };

  const handleRemoveItem = (productId: string, variantId: string | null, unitName: string) => {
    setItems((current) =>
      current.filter(
        (item) =>
          !(
            item.productId === productId &&
            (item.variantId ?? null) === variantId &&
            item.unitName === unitName
          )
      )
    );
  };

  /**
   * "Tambahkan Semua" fills the destination's shortfall, priced at this
   * vendor's last cost and in the product's own base unit — the old version
   * assumed every product was `Pcs` at the average cost.
   */
  const handleAutoFillLowStock = () => {
    if (!destinationWarehouse) {
      toast.error("Pilih gudang tujuan terlebih dahulu");
      return;
    }

    const additions: PurchaseOrderDraftLine[] = [];
    for (const product of lowStockProducts) {
      if (selectedVendor && !belongsToVendor(product, selectedVendor)) continue;
      const locationStock = product.warehouses[destinationWarehouse] || 0;
      const needed = product.minStock - locationStock;
      if (needed <= 0) continue;
      if (items.some((item) => item.productId === product.id)) continue;

      const base = baseUnitOf(packsOf(product, null));
      const unitCost = unitCostOf(product, null, base.name);
      const ordered = Math.max(needed, product.minStock);
      additions.push({
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        // Prefill always orders the default variant; a flavoured product needs
        // its variant chosen by hand, so skip every other combination.
        variantId: product.variants?.[0]?.id ?? null,
        quantity: ordered,
        unitName: base.name,
        conversionFactor: base.conversionFactor,
        unitCost,
        subtotal: Math.round(ordered * unitCost),
      });
    }

    if (additions.length > 0) {
      setItems((current) => [...current, ...additions]);
      toast.success(`${additions.length} produk stok rendah ditambahkan`);
    } else {
      toast.info("Tidak ada produk stok rendah yang perlu ditambahkan");
    }
  };

  const handleSave = async (submit: boolean) => {
    if (saving) return;

    const vendor = vendorOf(selectedVendor);
    if (!vendor) {
      toast.error("Pilih vendor terlebih dahulu");
      return;
    }

    const draft: PurchaseOrderDraftValues = {
      supplierId: vendor.id,
      supplierName: vendor.name,
      paymentTermsDays: Number(vendor.payment_terms_days ?? 0),
      destinationWarehouseId: destinationWarehouse,
      expectedDate,
      notes: notes.trim(),
      items,
      totalAmount,
    };

    // Same guards the write path applies, evaluated before anything is sent.
    const invalid = validatePurchaseOrder(
      {
        supplierId: draft.supplierId,
        destinationWarehouseId: draft.destinationWarehouseId,
        expectedDate: draft.expectedDate || null,
        items: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitName: item.unitName,
          conversionFactor: item.conversionFactor,
          unitCost: item.unitCost,
        })),
      },
      isoToday()
    );
    if (invalid) {
      toast.error(invalid);
      return;
    }

    setSaving(submit ? "submit" : "draft");
    try {
      await onSubmit(draft, { submit });
      onOpenChange(false);
    } catch (error) {
      // A partial write is impossible here (one transaction), so the draft is
      // still intact and the operator can simply retry.
      toast.error(error instanceof Error ? error.message : "Gagal menyimpan purchase order");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5" />
            {initialDraft ? "Ubah Draf Purchase Order" : "Buat Purchase Order"}
          </DialogTitle>
          <DialogDescription>
            Nomor PO dibuat otomatis saat disimpan. Mengajukan tidak memindahkan stok — barang
            baru masuk lewat penerimaan barang.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {lowStockProducts.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" />
                <span className="text-sm">
                  <strong>{lowStockProducts.length}</strong> produk stok rendah
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={handleAutoFillLowStock}>
                Tambahkan Semua
              </Button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label>Gudang Tujuan *</Label>
              <Select value={destinationWarehouse} onValueChange={setDestinationWarehouse}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pilih gudang" />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouseLabel(warehouse)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedWarehouse && isRackWarehouse(selectedWarehouse) && (
                <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                  <Info className="w-3 h-3 mt-0.5 shrink-0" />
                  Penerimaan langsung ke rak — stok tidak melewati gudang.
                </p>
              )}
            </div>
            <div>
              <Label>Vendor *</Label>
              <Select
                value={selectedVendor}
                onValueChange={(value) => {
                  setSelectedVendor(value);
                  const vendor = vendorOf(value);
                  const leadTime = Number(vendor?.lead_time_days ?? 0);
                  if (leadTime > 0 && !expectedDate) {
                    const date = new Date();
                    date.setDate(date.getDate() + leadTime);
                    setExpectedDate(date.toISOString().slice(0, 10));
                  }
                  // Lines belonging to another vendor can no longer be ordered
                  // from this one.
                  setItems((current) =>
                    current.filter((item) => {
                      const product = products.find((candidate) => candidate.id === item.productId);
                      return product ? belongsToVendor(product, value) : false;
                    })
                  );
                }}
              >
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Pilih vendor" />
                </SelectTrigger>
                <SelectContent>
                  {vendors.map((vendor) => (
                    <SelectItem key={vendor.id} value={vendor.id}>
                      {vendor.code ? `${vendor.code} · ${vendor.name}` : vendor.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {vendorOf(selectedVendor) && (
                <p className="text-xs text-muted-foreground mt-1">
                  Termin {Number(vendorOf(selectedVendor)?.payment_terms_days ?? 0)} hari · Lead
                  time {Number(vendorOf(selectedVendor)?.lead_time_days ?? 0)} hari
                </p>
              )}
            </div>
            <div>
              <Label>Tanggal Diharapkan</Label>
              <Input
                type="date"
                className="mt-1"
                value={expectedDate}
                onChange={(event) => setExpectedDate(event.target.value)}
              />
            </div>
          </div>

          <div className="border rounded-lg p-4 bg-muted/50">
            <Label className="text-sm font-medium">Tambah Produk</Label>
            <div className="flex gap-2 mt-2">
              <Popover open={openCombobox} onOpenChange={setOpenCombobox}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={openCombobox}
                    className="flex-1 justify-between"
                  >
                    {selectedProduct
                      ? filteredProducts.find((product) => product.id === selectedProduct)?.name
                      : "Pilih produk..."}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[300px] p-0">
                  <Command>
                    <CommandInput placeholder="Cari produk..." />
                    <CommandList>
                      <CommandEmpty>Produk tidak ditemukan.</CommandEmpty>
                      <CommandGroup>
                        {filteredProducts.map((product) => (
                          <CommandItem
                            key={product.id}
                            value={product.name}
                            onSelect={() => handleSelectProduct(product)}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                selectedProduct === product.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span className="flex items-center gap-2">
                                {product.name}
                                {product.stock <= product.minStock && (
                                  <AlertTriangle className="w-3 h-3 text-warning" />
                                )}
                              </span>
                              <span className="text-xs text-muted-foreground">{product.sku}</span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {variantOptions.length > 0 && (
                <Select
                  value={selectedVariant}
                  onValueChange={handleSelectVariant}
                  disabled={!selectedProduct}
                >
                  <SelectTrigger className="w-[150px]">
                    <SelectValue placeholder="Varian" />
                  </SelectTrigger>
                  <SelectContent>
                    {variantOptions.map((variant) => (
                      <SelectItem key={variant.id} value={variant.id}>
                        {variantLabel(variant.attributes)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Select value={selectedUnit} onValueChange={handleSelectUnit} disabled={!selectedProduct}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Satuan" />
                </SelectTrigger>
                <SelectContent>
                  {unitOptions.map((unitName) => (
                    <SelectItem key={unitName} value={unitName}>
                      {unitName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                type="number"
                step="0.001"
                min="0"
                placeholder="Harga Satuan"
                className="w-32"
                value={costPrice}
                onChange={(event) => setCostPrice(event.target.value)}
              />
              <Input
                type="number"
                step="0.001"
                min="0"
                placeholder="Jumlah"
                className="w-24"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
              <Button onClick={handleAddItem}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {agreedForSelection && (
              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                {costPrice.trim() &&
                Math.round(parseNumber(costPrice)) !== agreedForSelection.buyPrice ? (
                  <>
                    <AlertTriangle className="h-3 w-3 text-warning" />
                    Harga kesepakatan {formatCurrency(agreedForSelection.buyPrice)} — angka di atas
                    berbeda.
                  </>
                ) : (
                  <>
                    <Info className="h-3 w-3" />
                    Harga kesepakatan vendor: {formatCurrency(agreedForSelection.buyPrice)} (min.{" "}
                    {agreedForSelection.minQty})
                  </>
                )}
              </p>
            )}
          </div>

          {items.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produk</TableHead>
                    <TableHead className="text-center">Qty</TableHead>
                    <TableHead className="text-center">Satuan</TableHead>
                    <TableHead className="text-right">Harga Satuan</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={`${item.productId}-${item.variantId ?? ""}-${item.unitName}`}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Package className="w-4 h-4 text-muted-foreground" />
                          <div>
                            <p className="font-medium">{item.productName}</p>
                            <p className="text-xs text-muted-foreground">
                              {item.sku}
                              {item.variantName ? ` · ${item.variantName}` : ""}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{Number(item.quantity.toFixed(3))}</Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline">{item.unitName}</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        Rp {item.unitCost.toLocaleString("id-ID")}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        Rp {item.subtotal.toLocaleString("id-ID")}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveItem(item.productId, item.variantId ?? null, item.unitName)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={4} className="text-right font-semibold">
                      Total PO:
                    </TableCell>
                    <TableCell className="text-right font-bold text-lg">
                      Rp {totalAmount.toLocaleString("id-ID")}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}

          <div>
            <Label>Catatan</Label>
            <Textarea
              placeholder="Catatan untuk PO ini..."
              className="mt-1"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => handleSave(false)}
            disabled={saving !== null}
          >
            {saving === "draft" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Simpan Draf
          </Button>
          <Button className="flex-1" onClick={() => handleSave(true)} disabled={saving !== null}>
            {saving === "submit" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            Simpan & Ajukan
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
