/**
 * Money rules for packs and variants.
 *
 * A product is sold and bought in packs ("Pcs", "Renceng", "Karton"). The buy
 * price belongs to the vendor and the sell price to the owner, so they are
 * stored separately per pack and only the DERIVED numbers are computed here:
 *
 *   base cost   = buy price / conversion factor
 *   base price  = sell price / conversion factor
 *   margin      = (sell - buy) / factor     per base unit
 *
 * Deliberately dependency-free and pure: no SQL, no React, so the rules that
 * decide whether a carton is still profitable can be unit tested.
 */

export interface PackInput {
  /** Pack label as typed by the tenant, e.g. "Karton". */
  unitName: string;
  /** How many base units one pack holds. Factor 1 is the base unit itself. */
  conversionFactor: number;
  /** Buy price for ONE pack (IDR), as the vendor quoted it. */
  cost: number;
  /** Sell price for ONE pack (IDR). */
  price: number;
}

export interface PackEconomics extends PackInput {
  /** Buy price per base unit, rounded to whole rupiah. */
  baseCost: number;
  /** Sell price per base unit, rounded to whole rupiah. */
  basePrice: number;
  /** Margin per base unit, rounded to whole rupiah. */
  marginPerBase: number;
  /** Margin as a percentage of the sell price. 0 when the pack is free. */
  marginPercent: number;
}

export type PriceIssueCode =
  | "cost_above_price"
  | "buy_ladder_inverted"
  | "sell_ladder_inverted"
  | "margin_below_floor"
  | "duplicate_factor";

export interface PriceIssue {
  code: PriceIssueCode;
  /** The pack the issue was found on. */
  unitName: string;
  /** The pack it was compared against, when the issue is a comparison. */
  againstUnit?: string;
  /** Margin percent, for `margin_below_floor`. */
  marginPercent?: number;
}

export interface PriceSettings {
  /** Warn when a pack's margin falls below this percentage. */
  minMarginPercent?: number;
}

/** Tenants configure these in `tenants.settings.pricing`. */
export const DEFAULT_PRICE_SETTINGS: Required<PriceSettings> = {
  minMarginPercent: 5,
};

export const PRICING_SETTING_KEY = "pricing";
export const MIN_MARGIN_FIELD = "min_margin_pct";
export const ROUNDING_FIELD = "rounding";
export const VARIANCE_TOLERANCE_FIELD = "variance_tolerance_pct";

/** Round to whole rupiah; IDR has no minor unit. */
function money(value: number): number {
  return Math.round(Number.isFinite(value) ? value : 0);
}

/** Guard against a saved 0/NaN factor, which would divide by zero. */
function factorOf(pack: PackInput): number {
  const factor = Number(pack.conversionFactor);
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/** Derived economics for every pack, in the order given. */
export function packEconomics(packs: readonly PackInput[]): PackEconomics[] {
  return packs.map((pack) => {
    const factor = factorOf(pack);
    const cost = Number.isFinite(pack.cost) ? pack.cost : 0;
    const price = Number.isFinite(pack.price) ? pack.price : 0;
    return {
      ...pack,
      baseCost: money(cost / factor),
      basePrice: money(price / factor),
      marginPerBase: money((price - cost) / factor),
      // A pack with no sell price has no meaningful margin, not a 100% one.
      marginPercent: price > 0 ? ((price - cost) / price) * 100 : 0,
    };
  });
}

/**
 * Everything wrong with one variant's packs, cheapest first.
 *
 * `cost_above_price` and `duplicate_factor` block the save; the ladder and the
 * margin floor only warn, because an owner may deliberately price a pack at a
 * loss for a promotion.
 */
export function priceIssues(
  packs: readonly PackInput[],
  settings: PriceSettings = {}
): PriceIssue[] {
  const minMarginPercent = settings.minMarginPercent ?? DEFAULT_PRICE_SETTINGS.minMarginPercent;
  const economics = packEconomics(packs);
  const issues: PriceIssue[] = [];

  for (const pack of economics) {
    if (pack.cost >= pack.price && pack.price > 0) {
      issues.push({ code: "cost_above_price", unitName: pack.unitName });
    }
    if (pack.price > 0 && pack.marginPercent < minMarginPercent) {
      issues.push({
        code: "margin_below_floor",
        unitName: pack.unitName,
        marginPercent: Math.round(pack.marginPercent * 10) / 10,
      });
    }
  }

  // Two packs with the same factor are the same pack twice; the unique index
  // would reject it anyway, but the message belongs to the form.
  const seenFactors = new Map<number, string>();
  for (const pack of economics) {
    const factor = factorOf(pack);
    const previous = seenFactors.get(factor);
    if (previous) {
      issues.push({ code: "duplicate_factor", unitName: pack.unitName, againstUnit: previous });
    } else {
      seenFactors.set(factor, pack.unitName);
    }
  }

  issues.push(...ladderIssues(economics, "buy"), ...ladderIssues(economics, "sell"));
  return issues;
}

/**
 * Buying or selling a bigger pack must never cost MORE per base unit than a
 * smaller one: that silently throws money away on every carton, and it stops
 * customers from trading up.
 */
function ladderIssues(economics: PackEconomics[], side: "buy" | "sell"): PriceIssue[] {
  const priced = economics
    .filter((pack) => (side === "buy" ? pack.cost : pack.price) > 0)
    .sort((a, b) => factorOf(a) - factorOf(b));

  const issues: PriceIssue[] = [];
  let cheapest: PackEconomics | null = null;

  for (const pack of priced) {
    const perBase = side === "buy" ? pack.baseCost : pack.basePrice;
    const best = cheapest ? (side === "buy" ? cheapest.baseCost : cheapest.basePrice) : Infinity;
    if (perBase > best) {
      issues.push({
        code: side === "buy" ? "buy_ladder_inverted" : "sell_ladder_inverted",
        unitName: pack.unitName,
        againstUnit: cheapest!.unitName,
      });
    } else {
      cheapest = pack;
    }
  }
  return issues;
}

/** Human-readable message for a warning toast or an inline note. */
export function priceIssueMessage(issue: PriceIssue): string {
  const against = issue.againstUnit ? ` dibanding ${issue.againstUnit}` : "";
  switch (issue.code) {
    case "cost_above_price":
      return `Harga beli ${issue.unitName} lebih besar atau sama dengan harga jualnya`;
    case "buy_ladder_inverted":
      return `Harga beli per satuan ${issue.unitName} lebih mahal${against}`;
    case "sell_ladder_inverted":
      return `Harga jual per satuan ${issue.unitName} lebih mahal${against}`;
    case "margin_below_floor":
      return `Margin ${issue.unitName} hanya ${issue.marginPercent ?? 0}%`;
    case "duplicate_factor":
      return `Pecahan ${issue.unitName} punya konversi yang sama dengan ${issue.againstUnit}`;
    default:
      return "Harga perlu diperiksa";
  }
}

/** Blocks the save; everything else is advisory. */
export function isBlockingIssue(issue: PriceIssue): boolean {
  return issue.code === "cost_above_price" || issue.code === "duplicate_factor";
}

export interface SuggestSellPriceArgs {
  /** Buy price for the pack being priced. */
  buyPrice: number;
  conversionFactor: number;
  /** Desired margin as a percentage of the sell price. */
  marginPercent: number;
  /** Retail rounding step in rupiah; 0 keeps the exact value. */
  rounding?: 0 | 500 | 1000;
}

/**
 * Sell price for one pack from a margin target, never below the buy price.
 * Rounds UP so rounding cannot eat into the margin the owner asked for.
 */
export function suggestSellPrice({
  buyPrice,
  conversionFactor,
  marginPercent,
  rounding = 0,
}: SuggestSellPriceArgs): number {
  const cost = Number.isFinite(buyPrice) ? buyPrice : 0;
  const factor = Number.isFinite(conversionFactor) && conversionFactor > 0 ? conversionFactor : 1;
  const margin = Number.isFinite(marginPercent) ? marginPercent : 0;
  const clamped = Math.min(Math.max(margin, 0), 95);

  // Selling a carton at the retail margin applied to the RETAIL price of the
  // base unit is a different question; here the target applies to this pack.
  const raw = factor > 0 ? cost / (1 - clamped / 100) : cost;
  const floor = Math.max(cost, raw);
  if (!rounding) return money(floor);

  const rounded = Math.ceil(floor / rounding) * rounding;
  return money(rounded);
}

export interface ResolveBuyPriceArgs {
  /** `vendor_price_list.buy_price` for this vendor + pack. */
  priceList?: number | null;
  /** `product_units.cost` for this pack. */
  unitCost?: number | null;
  /** `vendor_products.last_cost`, a BASE-unit cost. */
  lastBaseCost?: number | null;
  conversionFactor: number;
}

export interface ResolvedBuyPrice {
  value: number;
  source: "pricelist" | "product" | "last_cost" | "none";
}

/**
 * Where a purchase order line gets its default buy price.
 *
 * Precedence is a contract, not a preference: the agreed price wins, then the
 * product's own buy price, then what this vendor last actually charged. A line
 * with `source: "none"` may still be saved — it is flagged "harga belum
 * disepakati" instead of being blocked.
 */
export function resolveBuyPrice({
  priceList,
  unitCost,
  lastBaseCost,
  conversionFactor,
}: ResolveBuyPriceArgs): ResolvedBuyPrice {
  const factor = Number.isFinite(conversionFactor) && conversionFactor > 0 ? conversionFactor : 1;

  if (typeof priceList === "number" && Number.isFinite(priceList) && priceList > 0) {
    return { value: money(priceList), source: "pricelist" };
  }
  if (typeof unitCost === "number" && Number.isFinite(unitCost) && unitCost > 0) {
    return { value: money(unitCost), source: "product" };
  }
  if (typeof lastBaseCost === "number" && Number.isFinite(lastBaseCost) && lastBaseCost > 0) {
    return { value: money(lastBaseCost * factor), source: "last_cost" };
  }
  return { value: 0, source: "none" };
}

/**
 * Percent difference between what was invoiced and what was agreed.
 * Returns 0 when there is nothing to compare against.
 */
export function priceVariancePercent(agreed: number, invoiced: number): number {
  if (!Number.isFinite(agreed) || agreed <= 0 || !Number.isFinite(invoiced)) return 0;
  return ((invoiced - agreed) / agreed) * 100;
}

/** True when the invoice drifted from the agreement beyond the tolerance. */
export function exceedsVarianceTolerance(
  agreed: number,
  invoiced: number,
  tolerancePercent: number
): boolean {
  return Math.abs(priceVariancePercent(agreed, invoiced)) > tolerancePercent;
}
