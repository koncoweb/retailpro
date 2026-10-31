import { describe, expect, it } from 'vitest';
import {
  exceedsVarianceTolerance,
  isBlockingIssue,
  packEconomics,
  priceIssueMessage,
  priceIssues,
  priceVariancePercent,
  resolveBuyPrice,
  suggestSellPrice,
} from './pricing';

describe('packEconomics', () => {
  it('derives per-base cost and price from the pack price', () => {
    const [carton] = packEconomics([
      { unitName: 'Karton', conversionFactor: 200, cost: 260_000, price: 350_000 },
    ]);
    expect(carton.baseCost).toBe(1_300);
    expect(carton.basePrice).toBe(1_750);
    expect(carton.marginPerBase).toBe(450);
    expect(carton.marginPercent).toBeCloseTo(25.714, 3);
  });

  it('keeps a fractional per-base cost rounded, not truncated to zero', () => {
    const [dozen] = packEconomics([
      { unitName: 'Lusin', conversionFactor: 12, cost: 110_000, price: 0 },
    ]);
    expect(dozen.baseCost).toBe(9_167);
  });

  it('reports a zero margin percent for a free pack instead of 100%', () => {
    const [free] = packEconomics([
      { unitName: 'Pcs', conversionFactor: 1, cost: 500, price: 0 },
    ]);
    expect(free.marginPercent).toBe(0);
  });

  it('treats a zero or missing conversion factor as 1', () => {
    const [pack] = packEconomics([
      { unitName: 'Pcs', conversionFactor: 0, cost: 1_000, price: 1_500 },
    ]);
    expect(pack.baseCost).toBe(1_000);
  });
});

describe('priceIssues', () => {
  const healthy = [
    { unitName: 'Pcs', conversionFactor: 1, cost: 1_500, price: 2_000 },
    { unitName: 'Renceng', conversionFactor: 10, cost: 14_000, price: 18_000 },
    { unitName: 'Karton', conversionFactor: 200, cost: 260_000, price: 350_000 },
  ];

  it('finds nothing wrong with a decreasing ladder', () => {
    expect(priceIssues(healthy)).toEqual([]);
  });

  it('blocks a pack whose buy price reaches its sell price', () => {
    const issues = priceIssues([
      { unitName: 'Pcs', conversionFactor: 1, cost: 2_000, price: 2_000 },
    ]);
    const blocking = issues.filter(isBlockingIssue);
    expect(blocking.map((issue) => issue.code)).toContain('cost_above_price');
  });

  it('flags a carton that costs more per piece than the retail pack', () => {
    const issues = priceIssues([
      { unitName: 'Pcs', conversionFactor: 1, cost: 1_500, price: 2_000 },
      { unitName: 'Karton', conversionFactor: 200, cost: 320_000, price: 350_000 },
    ]);
    const lad = issues.find((issue) => issue.code === 'buy_ladder_inverted');
    expect(lad?.unitName).toBe('Karton');
    expect(lad?.againstUnit).toBe('Pcs');
  });

  it('flags a sell ladder where the carton is not cheaper per piece', () => {
    const issues = priceIssues([
      { unitName: 'Pcs', conversionFactor: 1, cost: 1_000, price: 2_000 },
      { unitName: 'Karton', conversionFactor: 10, cost: 9_000, price: 21_000 },
    ]);
    expect(issues.map((issue) => issue.code)).toContain('sell_ladder_inverted');
  });

  it('warns below the margin floor without blocking', () => {
    const issues = priceIssues(
      [{ unitName: 'Pcs', conversionFactor: 1, cost: 1_950, price: 2_000 }],
      { minMarginPercent: 5 }
    );
    const floor = issues.find((issue) => issue.code === 'margin_below_floor');
    expect(floor?.marginPercent).toBe(2.5);
    expect(isBlockingIssue(floor!)).toBe(false);
  });

  it('detects two packs with the same conversion factor', () => {
    const issues = priceIssues([
      { unitName: 'Pcs', conversionFactor: 1, cost: 1_000, price: 1_500 },
      { unitName: 'Buah', conversionFactor: 1, cost: 1_000, price: 1_500 },
    ]);
    expect(issues.map((issue) => issue.code)).toContain('duplicate_factor');
  });
});

describe('priceIssueMessage', () => {
  it('names both packs on a ladder warning', () => {
    expect(
      priceIssueMessage({
        code: 'buy_ladder_inverted',
        unitName: 'Karton',
        againstUnit: 'Pcs',
      })
    ).toContain('Karton');
  });
});

describe('suggestSellPrice', () => {
  it('never returns less than the buy price', () => {
    const price = suggestSellPrice({ buyPrice: 260_000, conversionFactor: 200, marginPercent: 0 });
    expect(price).toBe(260_000);
  });

  it('applies the margin to the pack and rounds up', () => {
    const price = suggestSellPrice({
      buyPrice: 260_000,
      conversionFactor: 200,
      marginPercent: 20,
      rounding: 500,
    });
    // 260000 / 0.8 = 325000 exactly, already a multiple of 500.
    expect(price).toBe(325_000);
  });

  it('rounds up so rounding cannot eat the margin', () => {
    const price = suggestSellPrice({
      buyPrice: 1_000,
      conversionFactor: 1,
      marginPercent: 33,
      rounding: 1_000,
    });
    expect(price).toBe(2_000);
    expect(price).toBeGreaterThan(1_000 / (1 - 0.33));
  });
});

describe('resolveBuyPrice', () => {
  const base = { conversionFactor: 200 };

  it('prefers the agreed price list row', () => {
    expect(
      resolveBuyPrice({ ...base, priceList: 260_000, unitCost: 300_000, lastBaseCost: 1_300 })
    ).toEqual({ value: 260_000, source: 'pricelist' });
  });

  it('falls back to the product pack price', () => {
    expect(resolveBuyPrice({ ...base, priceList: null, unitCost: 280_000 })).toEqual({
      value: 280_000,
      source: 'product',
    });
  });

  it('rebuilds a pack price from the last base cost as a last resort', () => {
    expect(resolveBuyPrice({ ...base, lastBaseCost: 1_300 })).toEqual({
      value: 260_000,
      source: 'last_cost',
    });
  });

  it('reports none when nothing is known, without inventing zero-adjacent values', () => {
    expect(resolveBuyPrice({ ...base })).toEqual({ value: 0, source: 'none' });
  });

  it('ignores a zero pricelist row instead of treating it as agreed', () => {
    expect(resolveBuyPrice({ ...base, priceList: 0, unitCost: 15_000 }).source).toBe('product');
  });
});

describe('price variance', () => {
  it('computes the signed difference against the agreement', () => {
    expect(priceVariancePercent(260_000, 265_000)).toBeCloseTo(1.923, 3);
  });

  it('returns zero when there is no agreement to compare with', () => {
    expect(priceVariancePercent(0, 265_000)).toBe(0);
  });

  it('respects the tolerance in both directions', () => {
    expect(exceedsVarianceTolerance(260_000, 265_000, 2)).toBe(false);
    expect(exceedsVarianceTolerance(260_000, 270_000, 2)).toBe(true);
    expect(exceedsVarianceTolerance(260_000, 250_000, 2)).toBe(true);
  });
});
