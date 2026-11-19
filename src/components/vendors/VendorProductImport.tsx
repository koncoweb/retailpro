import { useRef, useState } from "react";
import { PermissionGate } from "@/components/auth/PermissionGate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { AlertCircle, Check, Download, Package, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { query, runTransaction, type Transaction } from "@/lib/db";
import { logAuditTx } from "@/lib/audit";
import { usePermissions } from "@/hooks/use-permissions";
import { WAREHOUSES_SQL, activeWarehouses, resolveBranchWarehouse, type WarehouseOption } from "@/lib/warehouse";
import { mintSkuForCategory } from "@/lib/inventory-utils";
import { VENDOR_CATEGORIES } from "@/lib/vendor";
import {
  parseVariantAttributes,
  variantKey,
  variantLabel,
  type VariantAttributes,
} from "@/lib/variants";
import {
  VENDOR_PRODUCT_COLUMNS,
  VENDOR_PRODUCT_TEMPLATE_ROWS,
  dateStamp,
  downloadCsv,
  downloadXlsx,
  keepValid,
  normalizeRows,
  readRows,
} from "@/lib/bulk-io";
import {
  carryVendorForward,
  expandProductCodes,
  groupVendorProductRows,
  planVendorProductImport,
  variantWriteRow,
  type ImportPlan,
  type ProductPlan,
  type VendorPlan,
} from "@/lib/vendor-import";
import {
  appendImportedVariants,
  insertImportedProduct,
  type ImportedPack,
} from "@/lib/product-write";
import {
  downloadVendorSheet,
  markPreferredVendor,
  resolveOrCreateVendor,
  upsertVendorCatalogLink,
  upsertVendorPrice,
  vendorCatalogSheetRows,
} from "@/lib/vendor-catalog";

/**
 * Bulk "vendor + product" sheet: master, catalogue and buy prices in one file.
 *
 * The vendor screen used to have an import that understood vendor columns only,
 * while the product import turned a typed vendor name into a `suppliers` row
 * without a code and without a price list. Neither could express "this vendor
 * sells these packs at these prices", which is the sheet a purchasing person
 * actually receives. This dialog reads that sheet, shows exactly what it will
 * change, and writes it through the same helpers the forms use, so the two can
 * no longer disagree about what a catalogue row means.
 *
 * One transaction per PRODUCT: the sheet's shape is one vendor with as many
 * products as its owner has, so a vendor block is far too big a thing to make
 * atomic — one bad product must cost one product, not the file. A cloud
 * round-trip per line is still avoided by writing each product in one.
 *
 * Design notes: `docs/spec-vendor-produk-terintegrasi.md`,
 * `docs/spec-sheet-vendor-satu-vendor.md`.
 */

/** Flat preview line: one sheet (vendor, product, variant, pack) with its verdict. */
interface PreviewLine {
  vendorName: string;
  vendorState: "baru" | "sudah ada";
  productName: string;
  sku: string;
  productState: "produk baru" | "tautkan produk" | "vendor saja" | "kode tidak dikenal";
  variantName: string;
  unitName: string;
  buyPrice: number;
  action: string;
  /** Why a line was not written; shown under the verdict badge. */
  reason?: string;
  tone: "new" | "update" | "keep" | "skip";
}

/** What the writer needs besides the plan itself. */
interface ApplyOptions {
  warehouseId: string | null;
  userId: string | null;
  priceMode: "overwrite" | "gap-only";
  /**
   * `manage_variants`, read the way the product screen reads it: the same
   * permission that lets a sheet make a product lets it change a product
   * template, so a line naming a missing variant or pack is written instead of
   * reported. Without it the plan never contains those writes in the first
   * place; the guard here is the second half of that promise.
   */
  mayCreateProducts: boolean;
}

/** Rows one write actually put in place, so the toast counts real numbers. */
interface BlockResult {
  created: number;
  linked: number;
  prices: number;
  /** Variants added to a product that already existed. */
  variants: number;
  /** `product_units` rows added, to new variants or to existing ones. */
  packs: number;
}

/** Everything a single product write needs that is not the product itself. */
interface WriteContext {
  vendorId: string;
  options: ApplyOptions;
  /** Numbers this vendor's blank-SKU lines already minted, collision-proof. */
  minted: string[];
  /** One date per block, so SKU minting stays stable across transactions. */
  today: Date;
}

const emptyResult = (): BlockResult => ({ created: 0, linked: 0, prices: 0, variants: 0, packs: 0 });

/** Sheet cell → the canonical vendor category the master stores. */
function mapVendorCategory(value: string | null | undefined): string {
  const token = String(value ?? "").trim().toLowerCase();
  return (
    VENDOR_CATEGORIES.find((c) => c.value === token || c.label.toLowerCase() === token)?.value ??
    "supplier"
  );
}

/**
 * Readable form of a `variantKey()` (`rasa=susu|ukuran=250ml`) for a sheet line
 * whose variant is not in the database yet, so the preview can still name it.
 */
function variantHint(key: string): string {
  return key
    .split("|")
    .map((pair) => pair.split("=")[1]?.trim() ?? "")
    .filter(Boolean)
    .join(" ");
}

/** Buy prices per pack, the way the product writer wants them. */
function packsOf(plan: ImportPlan["vendors"][number]["products"][number]): ImportedPack[] {
  return plan.packs.map((pack) => ({
    unitName: pack.unitName,
    conversionFactor: pack.conversionFactor,
    cost: pack.buyPrice,
    price: pack.sellPrice,
  }));
}

/** Row colour for a verdict. */
function toneClass(tone: PreviewLine["tone"]): string {
  if (tone === "new") return "bg-success/10 text-success";
  if (tone === "update") return "bg-warning/10 text-warning";
  if (tone === "skip") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
}

export function VendorProductImport({
  userId,
  branchId,
  onImported,
}: {
  userId?: string | null;
  /** The operator's branch, so opening stock lands in a warehouse that exists. */
  branchId?: string | null;
  /** Refresh the vendor list after a successful run. */
  onImported: () => void;
}) {
  const { can } = usePermissions();
  const mayCreateProducts = can("manage_variants");
  const mayOverwritePrices = can("manage_vendor_prices");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [lines, setLines] = useState<PreviewLine[]>([]);
  const [ignoredRows, setIgnoredRows] = useState(0);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  /**
   * Build the preview lines the dialog shows, straight from the plan.
   *
   * `variantNames` maps a stored `product_variants.id` to the label an operator
   * recognises, so a price line can say which flavour it reprices.
   */
  const describe = (next: ImportPlan, variantNames: Map<string, string>): PreviewLine[] => {
    const rows: PreviewLine[] = [];
    for (const vendor of next.vendors) {
      if (vendor.products.length === 0) {
        rows.push({
          vendorName: vendor.vendor.name,
          vendorState: vendor.isNew ? "baru" : "sudah ada",
          productName: "—",
          sku: "",
          productState: "vendor saja",
          variantName: "",
          unitName: "",
          buyPrice: 0,
          action: vendor.isNew ? "vendor dibuat" : "vendor dilewati",
          tone: vendor.isNew ? "new" : "keep",
        });
        continue;
      }
      for (const product of vendor.products) {
        if (product.action === "unknown-code") {
          rows.push({
            vendorName: vendor.vendor.name,
            vendorState: vendor.isNew ? "baru" : "sudah ada",
            productName: product.seed.name || `Kode ${product.seed.sku}`,
            sku: product.seed.sku ?? "",
            productState: "kode tidak dikenal",
            variantName: "",
            unitName: "",
            buyPrice: 0,
            action: "dilewati",
            reason: "kode tidak ada di katalog; satu sel berisi banyak kode hanya menautkan produk yang sudah ada",
            tone: "skip",
          });
          continue;
        }
        // A sheet whose only work on this product is to extend it — a flavour it
        // does not sell, a pack it does not carry — holds no price line for the
        // stored packs at all, and that is exactly the file the one-vendor format
        // produces. Reporting it as "catalogue saja (tanpa harga)" and stopping
        // would hide the rows the summary above this table already counted.
        if (
          product.packs.length === 0 &&
          product.newVariants.length === 0 &&
          product.skippedPacks.length === 0 &&
          product.ambiguousVariants.length === 0
        ) {
          rows.push({
            vendorName: vendor.vendor.name,
            vendorState: vendor.isNew ? "baru" : "sudah ada",
            productName: product.seed.name,
            sku: product.seed.sku ?? "",
            productState: product.action === "create" ? "produk baru" : "tautkan produk",
            variantName: "",
            unitName: "",
            buyPrice: 0,
            action: "catalogue saja (tanpa harga)",
            tone: "keep",
          });
          continue;
        }
        for (const pack of product.packs) {
          const label =
            pack.action === "overwrite"
              ? "harga diperbarui"
              : pack.action === "fill"
                ? "harga diisi"
                : product.action === "create"
                  ? "ikut produk baru"
                  : "dilewati";
          const seed = product.seed.packs.find(
            (row) => row.unitName === pack.unitName && row.conversionFactor === pack.conversionFactor
          );
          rows.push({
            vendorName: vendor.vendor.name,
            vendorState: vendor.isNew ? "baru" : "sudah ada",
            productName: product.seed.name,
            sku: product.seed.sku ?? "",
            productState: product.action === "create" ? "produk baru" : "tautkan produk",
            // Which flavour the price lands on is the whole point of the two new
            // columns, so the preview names it instead of leaving it implicit.
            variantName:
              (pack.variantId ? variantNames.get(pack.variantId) ?? "" : "") ||
              seed?.variantSku ||
              variantHint(seed?.variantKey ?? ""),
            unitName: `${pack.unitName}${pack.conversionFactor > 1 ? ` ×${pack.conversionFactor}` : ""}`,
            buyPrice: pack.buyPrice,
            action:
              pack.conversionFactor === 1 && product.action === "create"
                ? `produk + ${label}`
                : label,
            reason:
              pack.action === "skip" && pack.buyPrice > 0
                ? "sudah ada harga beli untuk vendor ini"
                : product.action === "create" && product.variantGroups.length > 0
                  ? "varian dibuat dari kolom Kode/Atribut Varian sheet ini"
                  : undefined,
            tone:
              pack.action === "overwrite"
                ? "update"
                : pack.action === "skip"
                  ? "skip"
                  : product.action === "create"
                    ? "new"
                    : "keep",
          });
        }
        // A line the app COULD have written had the operator held the template
        // permission: same report as ever, plus the reason the import stops at
        // reporting it.
        const blocked = (unitName: string): string | undefined =>
          product.blockedVariantWrites.includes(unitName)
            ? "butuh izin kelola varian untuk menambah varian"
            : undefined;
        for (const seed of product.newVariants) {
          for (const pack of seed.packs) {
            rows.push({
              vendorName: vendor.vendor.name,
              vendorState: vendor.isNew ? "baru" : "sudah ada",
              productName: product.seed.name,
              sku: product.seed.sku ?? "",
              productState: "tautkan produk",
              variantName:
                variantNames.get(seed.matchedVariantId ?? "") ||
                seed.variantSku ||
                variantHint(seed.attributeKey),
              unitName: `${pack.unitName}${pack.conversionFactor > 1 ? ` ×${pack.conversionFactor}` : ""}`,
              buyPrice: pack.buyPrice,
              action: seed.matchedVariantId ? "pecahan baru" : "varian baru",
              reason: seed.matchedVariantId
                ? "produk ini belum menjual pecahan ini; template produknya yang ditambah"
                : "varian ini belum ada di produk ini; template produknya yang ditambah",
              tone: "new",
            });
          }
        }
        for (const name of product.skippedPacks) {
          rows.push({
            vendorName: vendor.vendor.name,
            vendorState: vendor.isNew ? "baru" : "sudah ada",
            productName: product.seed.name,
            sku: product.seed.sku ?? "",
            productState: "tautkan produk",
            variantName: "",
            unitName: name,
            buyPrice: 0,
            action: "pecahan tidak ada di produk",
            reason: blocked(name),
            tone: "skip",
          });
        }
        for (const reason of product.ambiguousVariants) {
          const unitName = reason.split(" · ")[0] ?? reason;
          rows.push({
            vendorName: vendor.vendor.name,
            vendorState: vendor.isNew ? "baru" : "sudah ada",
            productName: product.seed.name,
            sku: product.seed.sku ?? "",
            productState: "tautkan produk",
            variantName: "",
            unitName,
            buyPrice: 0,
            action: "varian ambigu",
            reason: [reason, blocked(unitName)].filter(Boolean).join(" — "),
            tone: "skip",
          });
        }
      }
    }
    return rows;
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    try {
      const raw = await readRows(file);
      const normalized = normalizeRows(raw, VENDOR_PRODUCT_COLUMNS);
      // A sheet may state the vendor once and list twenty products under it, and
      // one `SKU` cell may hold several codes. Both are resolved here, before
      // validation, so `groupVendorProductRows` still sees one vendor per line.
      const carried = carryVendorForward(normalized);
      const expanded = expandProductCodes(carried);
      // A line has to name a vendor; without it nothing can be found or created.
      const { valid, invalid } = keepValid(expanded, ["vendorName"]);

      const groups = groupVendorProductRows(valid);

      // Read the whole existing key space once, so the preview can promise
      // numbers instead of hoping the write matches.
      const [vendorRes, productRes, variantRes, unitRes, linkRes, priceRes, warehouseRes] =
        await Promise.all([
          query<{ id: string; name: string; code: string | null }>(
            `SELECT id, name, code FROM suppliers`
          ),
          query<{ id: string; sku: string | null; name: string }>(
            `SELECT id, sku, name FROM products`
          ),
          query<{ id: string; product_id: string; sku: string | null; attributes: string | null }>(
            `SELECT id, product_id, sku, attributes FROM product_variants`
          ),
          query<{ variant_id: string; name: string; conversion_factor: number }>(
            `SELECT variant_id, name, conversion_factor FROM product_units`
          ),
          query<{ vendor_id: string; product_id: string; is_preferred: number }>(
            `SELECT vendor_id, product_id, is_preferred FROM vendor_products`
          ),
          query<{ vendor_id: string; variant_id: string; unit_name: string }>(
            `SELECT vendor_id, variant_id, unit_name FROM vendor_price_list`
          ),
          query<WarehouseOption>(WAREHOUSES_SQL),
        ]);

      const packsByProduct = new Map<string, Array<{ variantId: string; unitName: string; conversionFactor: number }>>();
      const variantsByProduct = new Map<
        string,
        Array<{ id: string; sku: string | null; attributeKey: string; attributes: VariantAttributes }>
      >();
      const variantNames = new Map<string, string>();
      for (const variant of variantRes.rows) {
        const attributes = parseVariantAttributes(variant.attributes);
        const list = variantsByProduct.get(variant.product_id) ?? [];
        list.push({
          id: variant.id,
          sku: variant.sku ?? null,
          attributeKey: variantKey(attributes),
          // The planner addresses a pack addition through the stored combination,
          // so a sheet can add a carton to a flavour without duplicating it.
          attributes,
        });
        variantsByProduct.set(variant.product_id, list);
        // "Default" tells an operator nothing on a one-flavour product; leave it
        // blank and let the pack column carry the line.
        variantNames.set(variant.id, variantLabel(attributes) === "Default" ? "" : variantLabel(attributes));
      }
      const variantToProduct = new Map(variantRes.rows.map((row) => [row.id, row.product_id]));
      for (const unit of unitRes.rows) {
        const productId = variantToProduct.get(unit.variant_id);
        if (!productId) continue;
        const list = packsByProduct.get(productId) ?? [];
        list.push({
          variantId: unit.variant_id,
          unitName: unit.name,
          conversionFactor: Number(unit.conversion_factor ?? 1),
        });
        packsByProduct.set(productId, list);
      }

      const next = planVendorProductImport(
        groups,
        {
          vendors: vendorRes.rows,
          products: productRes.rows.map((row) => ({
            ...row,
            packs: packsByProduct.get(row.id) ?? [],
            variants: variantsByProduct.get(row.id) ?? [],
          })),
          links: linkRes.rows.map((row) => ({
            vendorId: row.vendor_id,
            productId: row.product_id,
            isPreferred: Number(row.is_preferred ?? 0) === 1,
          })),
          prices: priceRes.rows.map((row) => ({
            vendorId: row.vendor_id,
            variantId: row.variant_id,
            unitName: row.unit_name,
          })),
        },
        {
          priceMode: mayOverwritePrices ? "overwrite" : "gap-only",
          // One key for both: whoever may change a product template may let a
          // price sheet add the variant or pack it is really quoting.
          mayCreateVariants: mayCreateProducts,
        }
      );

      const active = activeWarehouses(warehouseRes.rows);
      const fallback =
        (await resolveBranchWarehouse(branchId ?? null)) ?? active[0]?.id ?? "";

      setPlan(next);
      setLines(describe(next, variantNames));
      setIgnoredRows(invalid.length);
      setWarehouses(active);
      setWarehouseId(fallback);
      setOpen(true);

      if (next.summary.newProducts > 0 && !mayCreateProducts) {
        toast.error("Baris produk dilewati: tidak berwenang mengelola template produk.");
      } else if (
        !mayCreateProducts &&
        next.vendors.some((vendor) => vendor.products.some((p) => p.blockedVariantWrites.length > 0))
      ) {
        toast.error(
          "Varian dan pecahan baru dilewati: tidak berwenang mengelola template produk."
        );
      }
    } catch (error) {
      console.error("Vendor + product import failed:", error);
      toast.error("Gagal membaca file. Pastikan format CSV/Excel benar.");
    }
  };

  /**
   * Write one product of one vendor, inside the caller's transaction.
   *
   * The plan already decided what each line means, so this only executes it: a
   * brand-new product through the same writer the product import uses, or the
   * template additions, the catalogue row and the prices of a product that
   * exists. It reports the rows it placed, so the toast can be read against the
   * database instead of against the plan's promises.
   */
  const applyProductWrite = async (
    tx: Transaction,
    product: ProductPlan,
    ctx: WriteContext
  ): Promise<BlockResult> => {
    const { vendorId, options } = ctx;
    const wrote = emptyResult();
    const base =
      product.packs.find((pack) => pack.conversionFactor === 1) ?? product.packs[0] ?? null;
    const minOrder = product.seed.packs.find((pack) => pack.minOrderQty)?.minOrderQty ?? null;
    const vendorSku = product.seed.packs.find((pack) => pack.vendorSku)?.vendorSku ?? null;

    if (product.action === "create") {
      if (!options.mayCreateProducts) return wrote;
      const sku =
        product.seed.sku ||
        (await mintSkuForCategory(tx, product.seed.category, ctx.today, ctx.minted));
      if (!product.seed.sku) ctx.minted.push(sku);
      await insertImportedProduct(
        tx,
        {
          sku,
          name: product.seed.name,
          category: product.seed.category || "Umum",
          price: base?.sellPrice ?? 0,
          cost: base?.buyPrice ?? 0,
          stock: product.seed.stock,
          minStock: product.seed.minStock,
          unitName: base?.unitName,
          packs: packsOf(product).filter((pack) => pack.conversionFactor !== 1),
          minOrderQty: minOrder,
          vendorSku,
          // One variant row per combination the lines name. A flat file names
          // none, so it still writes the single variant it always wrote.
          variants: product.variants.map(variantWriteRow),
          variantGroups: product.variantGroups,
        },
        {
          warehouseId: options.warehouseId,
          vendorId,
          userId: options.userId,
          isPreferredVendor: true,
          priceMode: options.priceMode,
          priceSource: "import",
        }
      );
      wrote.created += 1;
      wrote.prices += product.packs.filter((pack) => pack.buyPrice > 0).length;
      return wrote;
    }

    // An existing product is never renamed and never duplicated: the sheet only
    // says "this vendor offers it, at this price". A multi-code line whose code
    // resolved to nothing has no id, so it reaches the same early return.
    const productId = product.productId;
    if (!productId) return wrote;

    // 1. What the sheet adds to the product's TEMPLATE — a variant it lacks, or a
    //    pack one of its variants lacks. That writer owns those `product_units`
    //    rows and the prices quoted on them, so nothing below writes them twice.
    if (product.newVariants.length > 0 && options.mayCreateProducts) {
      const extended = await appendImportedVariants(
        tx,
        productId,
        {
          sku: product.seed.sku,
          variantGroups: product.variantGroups,
          variants: product.newVariants.map(variantWriteRow),
        },
        {
          warehouseId: options.warehouseId,
          vendorId,
          userId: options.userId,
          priceMode: options.priceMode,
          priceSource: "import",
          minOrderQty: minOrder,
          vendorSku,
          // Preference is decided once, by the catalogue row below.
          claimPreference: false,
        }
      );
      wrote.variants += extended.addedVariants;
      wrote.packs += extended.addedPacks;
      wrote.prices += product.newVariants.reduce(
        (total, seed) => total + seed.packs.filter((pack) => pack.buyPrice > 0).length,
        0
      );
    }

    // 2. The catalogue row. Its last cost is the sheet's single-unit price; when
    //    the sheet only named a variant, the price of that variant's own base
    //    pack is the number this vendor just quoted, so the field is not zeroed.
    const addedBase =
      product.newVariants
        .flatMap((seed) => seed.packs)
        .find((pack) => pack.conversionFactor === 1 && pack.buyPrice > 0) ?? null;
    const cost = base?.buyPrice ?? addedBase?.buyPrice ?? 0;
    await upsertVendorCatalogLink(tx, {
      vendorId,
      productId,
      vendorSku,
      lastCost: cost,
      minOrderQty: minOrder,
      isPreferred: false,
    });

    if (product.claimPreference) {
      await markPreferredVendor(tx, { vendorId, productId });
      // A product without a main vendor adopts the one the sheet names.
      await tx.query(
        `UPDATE products SET supplier_id = $1 WHERE id = $2 AND supplier_id IS NULL`,
        [vendorId, productId]
      );
    }

    for (const pack of product.packs) {
      if (pack.action === "skip" || !pack.variantId || pack.buyPrice <= 0) continue;
      await upsertVendorPrice(tx, {
        vendorId,
        variantId: pack.variantId,
        unitName: pack.unitName,
        conversionFactor: pack.conversionFactor,
        buyPrice: pack.buyPrice,
        minQty: minOrder,
        userId: options.userId,
        mode: pack.action === "overwrite" ? "overwrite" : "gap-only",
        source: "import",
      });
      wrote.prices += 1;
    }
    wrote.linked += 1;
    return wrote;
  };

  /**
   * Apply one vendor block: its master first, then one transaction per product.
   *
   * The master needs its own round-trip because every product write hangs off
   * the id it resolves to. After that the PRODUCT is the unit of work, because a
   * file is now one vendor with as many products as its owner has: two hundred
   * rows must not be one atomic thing that row ninety can undo. A legacy sheet
   * holding several vendors still isolates a failure inside one vendor here.
   */
  const applyVendorBlock = async (
    vendor: VendorPlan,
    options: ApplyOptions
  ): Promise<{ wrote: BlockResult; failedProducts: number }> => {
    const vendorId = await runTransaction(async (tx) =>
      resolveOrCreateVendor(tx, {
        name: vendor.vendor.name,
        code: vendor.vendor.code,
        category: mapVendorCategory(vendor.vendor.category),
        contactPerson: vendor.vendor.contactPerson,
        phone: vendor.vendor.phone,
        email: vendor.vendor.email,
        paymentTermsDays: vendor.vendor.paymentTermsDays,
      })
    );
    const wrote = emptyResult();
    if (!vendorId) return { wrote, failedProducts: 0 };

    // Hoisted out of the transactions so two blank-SKU lines of one vendor still
    // cannot mint the same number, and one date keeps those codes stable.
    const minted: string[] = [];
    const today = new Date();
    let failedProducts = 0;

    for (const product of vendor.products) {
      try {
        const result = await runTransaction(async (tx) =>
          applyProductWrite(tx, product, { vendorId, options, minted, today })
        );
        wrote.created += result.created;
        wrote.linked += result.linked;
        wrote.prices += result.prices;
        wrote.variants += result.variants;
        wrote.packs += result.packs;
      } catch (error) {
        // One bad product costs one product, never the sheet.
        failedProducts += 1;
        console.error(
          `Import row failed for ${product.seed.sku ?? product.seed.name}:`,
          error
        );
      }
    }

    // One summary line per vendor block, on top of the per-product audit each
    // writer already logs: "this sheet was imported, and this is what it cost".
    const changed =
      wrote.created + wrote.linked + wrote.prices + wrote.variants + wrote.packs > 0;
    if (changed) {
      await runTransaction(async (tx) => {
        await logAuditTx(tx, {
          action: "update",
          entity: "suppliers",
          entityId: vendorId,
          details: {
            via: "import vendor + produk",
            vendor: vendor.vendor.name,
            createdProducts: wrote.created,
            linkedProducts: wrote.linked,
            priceRows: wrote.prices,
            addedVariants: wrote.variants,
            addedPacks: wrote.packs,
          },
          userId: options.userId ?? undefined,
        });
      });
    }

    return { wrote, failedProducts };
  };

  const handleConfirm = async () => {
    if (!plan) return;
    setApplying(true);
    let blocks = 0;
    let failedBlocks = 0;
    let failedProducts = 0;
    const wrote = emptyResult();
    try {
      for (const vendor of plan.vendors) {
        try {
          const result = await applyVendorBlock(vendor, {
            warehouseId: warehouseId || null,
            userId: userId ?? null,
            priceMode: mayOverwritePrices ? "overwrite" : "gap-only",
            mayCreateProducts,
          });
          blocks += 1;
          failedProducts += result.failedProducts;
          wrote.created += result.wrote.created;
          wrote.linked += result.wrote.linked;
          wrote.prices += result.wrote.prices;
          wrote.variants += result.wrote.variants;
          wrote.packs += result.wrote.packs;
        } catch (error) {
          // One vendor's block failing must not roll back the others.
          failedBlocks += 1;
          console.error(`Import block failed for ${vendor.vendor.name}:`, error);
        }
      }

      // Counts of what was WRITTEN, not of what was planned: a permission that
      // blocked a row, or a row that threw, has to show up in this line.
      const summary = plan.summary;
      const parts = [
        `${blocks} vendor diproses`,
        `${wrote.created} produk baru`,
        `${wrote.linked} produk ditautkan`,
      ];
      if (wrote.variants > 0) parts.push(`${wrote.variants} varian baru`);
      if (wrote.packs > 0) parts.push(`${wrote.packs} pecahan baru`);
      parts.push(`${wrote.prices} harga beli`);
      if (summary.skippedPacks > 0) parts.push(`${summary.skippedPacks} pecahan dilewati`);
      if (summary.ambiguousVariants > 0)
        parts.push(`${summary.ambiguousVariants} harga varian dilewati (sebutkan Kode Varian)`);
      if (summary.unknownCodes > 0) parts.push(`${summary.unknownCodes} kode tidak dikenal`);
      if (ignoredRows > 0) parts.push(`${ignoredRows} baris tanpa nama vendor dibuang`);
      if (failedProducts > 0) parts.push(`${failedProducts} produk gagal ditulis`);
      if (failedBlocks > 0) parts.push(`${failedBlocks} blok vendor gagal`);

      (failedProducts > 0 || failedBlocks > 0 ? toast.error : toast.success)(parts.join(" · "));
      setOpen(false);
      setPlan(null);
      setLines([]);
      onImported();
    } finally {
      setApplying(false);
    }
  };

  /**
   * Every vendor's catalogue, in the exact shape this dialog reads, so an export
   * can be edited in Excel and imported back without re-typing columns.
   *
   * The rows come from `vendorCatalogSheetRows()` — the same builder the
   * one-vendor sheet uses — so no export can drift from the import that has to
   * accept it.
   */
  const handleExportCatalogue = async (format: "xlsx" | "csv") => {
    try {
      const rows = await vendorCatalogSheetRows();
      if (rows.length === 0) {
        toast.error("Belum ada katalog vendor untuk diekspor");
        return;
      }
      const name = `katalog_vendor_produk_${dateStamp()}.${format}`;
      if (format === "csv") downloadCsv(name, rows, VENDOR_PRODUCT_COLUMNS);
      else downloadXlsx(name, rows, VENDOR_PRODUCT_COLUMNS, "Katalog");
      toast.success(`${rows.length} baris katalog diekspor`);
    } catch (error) {
      console.error("Catalogue export failed:", error);
      toast.error("Gagal mengekspor katalog");
    }
  };

  /**
   * The one-vendor sheet for every vendor this file names: row 1 is the vendor,
   * the rows below are its products, variants and packs, with the vendor columns
   * left blank. Re-importing it writes nothing new, which is what makes it safe
   * to hand to a supplier as "isi harga ini lalu kirim balik".
   */
  const handleExportVendorSheets = async (format: "xlsx" | "csv") => {
    if (!plan) return;
    try {
      for (const vendor of plan.vendors) {
        if (!vendor.vendorId) {
          // A vendor the file wants to create has no catalogue to export yet.
          toast.error(`${vendor.vendor.name}: vendor baru, belum ada katalog untuk diekspor.`);
          continue;
        }
        const count = await downloadVendorSheet(vendor.vendorId, vendor.vendor.code, format);
        toast.success(`${count} baris sheet ${vendor.vendor.name} diekspor`);
      }
    } catch (error) {
      console.error("Vendor sheet export failed:", error);
      toast.error("Gagal mengekspor sheet vendor");
    }
  };

  const handleTemplate = (format: "xlsx" | "csv") => {
    const name = `template_vendor_produk.${format}`;
    if (format === "csv") downloadCsv(name, VENDOR_PRODUCT_TEMPLATE_ROWS, VENDOR_PRODUCT_COLUMNS);
    else downloadXlsx(name, VENDOR_PRODUCT_TEMPLATE_ROWS, VENDOR_PRODUCT_COLUMNS, "Template");
    toast.success("Template berhasil didownload");
  };

  const summary = plan?.summary ?? null;
  const willCreateProducts = (summary?.newProducts ?? 0) > 0 && !mayCreateProducts;
  /** More than one vendor in one file: allowed, but no longer the format. */
  const multiVendorFile = (plan?.vendors.length ?? 0) > 1;

  return (
    <>
      <input
        ref={fileInputRef}
        id="vendor-product-import-file"
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={handleFile}
        className="hidden"
      />
      {/* The combined flow needs both keys: a vendor catalogue and its products. */}
      <PermissionGate permission="manage_vendor_prices">
        <PermissionGate permission="manage_variants">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4" />
            Import Vendor + Produk
          </Button>
        </PermissionGate>
      </PermissionGate>
      <PermissionGate permission="export_reports">
        <Button variant="outline" className="gap-2" onClick={() => handleExportCatalogue("xlsx")}>
          <Download className="w-4 h-4" />
          Ekspor Katalog
        </Button>
      </PermissionGate>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-muted-foreground"
        onClick={() => handleTemplate("csv")}
      >
        <Package className="w-4 h-4" />
        Template Vendor + Produk (CSV)
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 text-muted-foreground"
        onClick={() => handleTemplate("xlsx")}
      >
        <Package className="w-4 h-4" />
        Template Vendor + Produk (Excel)
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-y-auto flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-primary" />
              Preview Import Vendor + Produk
            </DialogTitle>
            <DialogDescription>
              {summary &&
                `${summary.newVendors} vendor baru · ${summary.existingVendors} vendor sudah ada · ${summary.newProducts} produk baru · ${summary.linkedProducts} produk ditautkan · ${summary.priceOverwrites + summary.priceFills} harga beli (${summary.priceOverwrites} diperbarui)`}
              {summary && summary.vendorOnlyRows > 0 && ` · ${summary.vendorOnlyRows} baris vendor saja`}
              {summary && summary.newVariants > 0 && ` · ${summary.newVariants} varian baru`}
              {summary && summary.newPacks > 0 && ` · ${summary.newPacks} pecahan baru`}
              {summary && summary.ambiguousVariants > 0 && ` · ${summary.ambiguousVariants} harga varian dilewati`}
              {summary && summary.unknownCodes > 0 && ` · ${summary.unknownCodes} kode tidak dikenal`}
              {ignoredRows > 0 && ` · ${ignoredRows} baris dibuang`}
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-between gap-3 p-3 bg-muted/50 rounded-lg text-sm">
            <p className="text-muted-foreground">
              Satu sheet untuk satu vendor: baris pertama hanya kolom vendor, baris
              berikutnya produk vendor itu dengan kolom vendor dibiarkan kosong.
              Master bersifat menambah — vendor dan produk yang sudah ada tidak
              diganti namanya. Harga beli mengikuti sheet. Baris yang mengosongkan
              Nama/Kode Vendor mengikuti baris di atasnya, dan satu sel SKU boleh
              berisi beberapa kode dipisah <code>;</code>.
            </p>
            {warehouses.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <Label className="text-xs whitespace-nowrap">Stok awal ke</Label>
                <Select value={warehouseId} onValueChange={setWarehouseId}>
                  <SelectTrigger className="h-8 w-[190px]">
                    <SelectValue placeholder="Gudang" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((warehouse) => (
                      <SelectItem key={warehouse.id} value={warehouse.id}>
                        {warehouse.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {willCreateProducts && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 rounded-lg text-destructive text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Baris produk baru tidak akan dibuat: import gabungan ini butuh izin
              template produk. Vendor dan harganya tetap bisa masuk.
            </div>
          )}

          {multiVendorFile && (
            <div className="flex items-center gap-2 p-3 bg-warning/10 rounded-lg text-warning text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Sheet ini memuat {plan?.vendors.length ?? 0} vendor — format barunya
              satu vendor per file. Import tetap jalan; setiap vendor diproses
              sendiri-sendiri, dan satu produk yang gagal hanya menunda produk itu.
            </div>
          )}

          <div className="flex-1 min-h-[200px] max-h-[50vh] overflow-auto border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Produk</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Varian</TableHead>
                  <TableHead>Satuan</TableHead>
                  <TableHead className="text-right">Harga Beli</TableHead>
                  <TableHead>Rencana</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.slice(0, 40).map((line, index) => (
                  <TableRow key={index}>
                    <TableCell>
                      <p className="text-sm font-medium">{line.vendorName}</p>
                      <p className="text-xs text-muted-foreground">{line.vendorState}</p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{line.productName}</p>
                      <p className="text-xs text-muted-foreground">{line.productState}</p>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {line.sku || <span className="text-muted-foreground">(otomatis)</span>}
                    </TableCell>
                    <TableCell className="text-xs">{line.variantName || "-"}</TableCell>
                    <TableCell className="text-sm">{line.unitName || "-"}</TableCell>
                    <TableCell className="text-right text-sm">
                      {line.buyPrice ? `Rp ${line.buyPrice.toLocaleString("id-ID")}` : "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={toneClass(line.tone)}>
                        {line.action}
                      </Badge>
                      {line.reason && (
                        <p className="text-xs text-muted-foreground mt-1">{line.reason}</p>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {lines.length > 40 && (
              <div className="p-3 text-center text-sm text-muted-foreground border-t">
                ... dan {lines.length - 40} baris lainnya
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-2">
            {/*
             * The way out of a half-filled sheet: hand each vendor named in this
             * file its own one-vendor sheet, in the shape the dialog just read.
             */}
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 shrink-0 text-muted-foreground"
              onClick={() => handleExportVendorSheets("xlsx")}
            >
              <Download className="w-4 h-4" />
              Sheet per Vendor (Excel)
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 shrink-0 text-muted-foreground"
              onClick={() => handleExportVendorSheets("csv")}
            >
              <Download className="w-4 h-4" />
              Sheet per Vendor (CSV)
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>
              <X className="w-4 h-4 mr-2" />
              Batal
            </Button>
            <Button
              className="flex-1 gap-2"
              onClick={handleConfirm}
              disabled={applying || !plan || plan.vendors.length === 0}
            >
              {applying ? (
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              Import {plan?.vendors.length ?? 0} Vendor
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
