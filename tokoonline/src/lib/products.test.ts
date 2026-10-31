import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  baseUnit,
  fromPrice,
  isProductSoldOut,
  isSoldOut,
  maxQuantity,
  sellableUnits,
  shelves,
  stockLabel,
  unitLabel,
  type Product,
} from "./products.ts";

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: "p-1",
    slug: "tlr-003",
    sku: "TLR-003",
    name: "Susu Kental Manis",
    description: null,
    category: "Susu & Olahan",
    stock: 48,
    lowStock: false,
    units: [
      { name: "pcs", factor: 1, price: 4_000 },
      { name: "dus", factor: 48, price: 160_000 },
    ],
    ...overrides,
  };
}

function twoFlavours(): Product {
  return product({
    variants: [
      {
        id: "v-putih",
        sku: "TLR-003-PUTIH",
        label: "Putih",
        attributes: { Rasa: "Putih" },
        stock: 30,
        units: [
          { name: "pcs", factor: 1, price: 4_000 },
          { name: "dus", factor: 48, price: 160_000 },
        ],
      },
      {
        id: "v-cokelat",
        sku: "TLR-003-COKELAT",
        label: "Cokelat",
        attributes: { Rasa: "Cokelat" },
        stock: 0,
        units: [
          { name: "pcs", factor: 1, price: 4_500 },
          { name: "dus", factor: 48, price: 180_000 },
        ],
      },
    ],
  });
}

describe("storefront catalogue helpers", () => {
  it("treats a single-SKU product as one shelf built from its own packs", () => {
    const [only] = shelves(product());
    assert.equal(shelves(product()).length, 1);
    assert.equal(only.id, null);
    assert.equal(only.label, null);
    assert.equal(only.stock, 48);
    assert.equal(only.units.length, 2);
  });

  it("gives every variant its own shelf, stock and packs", () => {
    const list = shelves(twoFlavours());
    assert.deepEqual(
      list.map((shelf) => shelf.label),
      ["Putih", "Cokelat"],
    );
    assert.equal(list[0].stock, 30);
    assert.equal(list[1].stock, 0);
    // The Cokelat shelf prices its own goods; the two must not mix.
    assert.equal(fromPrice(twoFlavours()), 4_000);
    assert.equal(list[1].units[0].price, 4_500);
  });

  it("does not let the stock of one flavour cover another", () => {
    const [putih, cokelat] = shelves(twoFlavours());
    assert.equal(isSoldOut(putih), false);
    assert.equal(isSoldOut(cokelat), true);
    // The product tile only says "Habis" when every shelf is empty.
    assert.equal(isProductSoldOut(twoFlavours()), false);
    assert.equal(isProductSoldOut(product({ stock: 0 })), true);
  });

  it("only offers packs the shelf can actually fill", () => {
    const [putih] = shelves(twoFlavours());
    // 30 pcs cannot fill one 48-piece carton.
    assert.deepEqual(
      sellableUnits(putih).map((unit) => unit.name),
      ["pcs"],
    );
    assert.equal(maxQuantity(putih, { name: "dus", factor: 48, price: 160_000 }), 1);
  });

  it("labels a pack with the base unit of its own shelf", () => {
    const [putih] = shelves(twoFlavours());
    assert.equal(baseUnit(putih).name, "pcs");
    assert.equal(unitLabel(putih, { name: "dus", factor: 48, price: 160_000 }), "dus · 48 pcs");
    assert.equal(stockLabel(putih), "30 pcs");
  });

  it("hides the backfilled Default SKU behind the product's own name", () => {
    // Every product has at least one variant row; the one without attributes is
    // the product, so the basket must not read "Tepung Terigu · Default".
    const single = product({
      variants: [
        {
          id: "v-default",
          sku: "TLR-003",
          label: "Default",
          attributes: {},
          stock: 48,
          units: [{ name: "pcs", factor: 1, price: 4_000 }],
        },
      ],
    });
    const [only] = shelves(single);
    assert.equal(shelves(single).length, 1);
    assert.equal(only.id, "v-default");
    assert.equal(only.label, null);
    assert.equal(only.stock, 48);
  });

  it("never returns zero packs when the API sends variants without prices", () => {
    // A variant row can arrive before its packs are written; the product's own
    // list then has to serve, otherwise the page would crash on units[0].
    const orphan = product({
      variants: [
        {
          id: "v-empty",
          sku: "TLR-003-X",
          label: "Baru",
          attributes: {},
          stock: 0,
          units: [],
        },
      ],
    });
    assert.equal(shelves(orphan).length, 1);
    assert.equal(shelves(orphan)[0].id, null);
    assert.equal(fromPrice(orphan), 4_000);
  });
});
