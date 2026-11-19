import { describe, expect, it } from "vitest";
import { findScanMatch } from "./barcode-match";
import type { Product } from "@/types";

// Only the fields the resolver reads are filled; the rest are irrelevant here.
function makeProduct(over: Partial<Product>): Product {
  return {
    id: "p",
    tenant_id: "t",
    sku: "",
    name: "Produk",
    category: "C",
    price: 0,
    cost: 0,
    unit_type: "Pcs",
    min_stock_alert: 0,
    units: [],
    stock_by_warehouse: {},
    ...over,
  } as Product;
}

const products: Product[] = [
  makeProduct({
    id: "p1",
    sku: "SKU-PROD1",
    units: [{ name: "Pcs", conversion_factor: 1, price: 5000, barcode: "111" }],
    variants: [
      {
        id: "v1",
        sku: "VAR-A",
        barcode: "DIRECT-A",
        label: "Susu",
        price: 5000,
        units: [
          { name: "Karton", conversion_factor: 24, price: 100000, barcode: "222" },
          { name: "Pcs", conversion_factor: 1, price: 5000, barcode: "333" },
        ],
        stock_by_warehouse: {},
      },
    ],
  }),
  makeProduct({
    id: "p2",
    sku: "SKU-PROD2",
    variants: [
      { id: "v2", sku: "VAR-B", label: "Teh", price: 3000, units: [], stock_by_warehouse: {} },
    ],
  }),
];

describe("findScanMatch", () => {
  it("prefers an exact variant pack barcode and returns that pack", () => {
    const match = findScanMatch(products, "222");
    expect(match?.kind).toBe("unit-barcode");
    expect(match?.product.id).toBe("p1");
    expect(match?.variant?.id).toBe("v1");
    expect(match?.unit?.name).toBe("Karton");
  });

  it("resolves a direct variant barcode to its factor-one pack", () => {
    const match = findScanMatch(products, "DIRECT-A");
    expect(match?.variant?.id).toBe("v1");
    expect(match?.unit?.conversion_factor).toBe(1);
  });

  it("matches a flat product-unit barcode with no variant", () => {
    const match = findScanMatch(products, "111");
    expect(match?.kind).toBe("unit-barcode");
    expect(match?.variant).toBeNull();
    expect(match?.unit?.barcode).toBe("111");
  });

  it("resolves a variant SKU to its base (factor-1) pack", () => {
    const match = findScanMatch(products, "VAR-A");
    expect(match?.kind).toBe("variant-sku");
    expect(match?.variant?.id).toBe("v1");
    expect(match?.unit?.conversion_factor).toBe(1);
  });

  it("resolves a product SKU to its base pack", () => {
    const match = findScanMatch(products, "SKU-PROD1");
    expect(match?.kind).toBe("product-sku");
    expect(match?.unit?.name).toBe("Pcs");
  });

  it("trims surrounding whitespace from the scanned code", () => {
    expect(findScanMatch(products, "  222  ")?.unit?.name).toBe("Karton");
  });

  it("returns null for an unknown or empty code", () => {
    expect(findScanMatch(products, "999")).toBeNull();
    expect(findScanMatch(products, "")).toBeNull();
    expect(findScanMatch(products, "   ")).toBeNull();
  });

  it("tolerates a variant-SKU hit that has no base pack", () => {
    const match = findScanMatch(products, "VAR-B");
    expect(match?.kind).toBe("variant-sku");
    expect(match?.unit).toBeNull();
  });
});
