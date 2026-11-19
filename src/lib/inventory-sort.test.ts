import { describe, expect, it } from 'vitest';
import { defaultSortDirection, sortInventoryRows, type InventorySortableRow } from './inventory-sort';

interface Row extends InventorySortableRow {
  id: string;
}

// Two suppliers differing only by case, and a lower-case product name, so the
// text comparisons have to prove they ignore case rather than fall back to
// "Z before a" that a naive byte sort would give.
const rows: Row[] = [
  { id: '1', name: 'Tepung', category: 'Bahan', price: 8000, cost: 6000, stock: 5, supplier: 'Alpha' },
  { id: '2', name: 'Gula', category: 'Bahan', price: 12000, cost: 9000, stock: 50, supplier: 'Beta' },
  { id: '3', name: 'kopi', category: 'Minuman', price: 3000, cost: 1500, stock: 2, supplier: 'alpha' },
];

const ids = (key: Parameters<typeof sortInventoryRows<Row>>[1], dir: 'asc' | 'desc') =>
  sortInventoryRows(rows, key, dir).map((row) => row.id);

describe('sortInventoryRows', () => {
  it('returns the input untouched when no column is selected', () => {
    expect(sortInventoryRows(rows, null, 'asc')).toBe(rows);
  });

  it('orders numeric columns by value, not by text', () => {
    // As text, "50" would sit before "5"; as numbers it must sit after.
    expect(ids('stock', 'asc')).toEqual(['3', '1', '2']);
    expect(ids('stock', 'desc')).toEqual(['2', '1', '3']);
    expect(ids('price', 'asc')).toEqual(['3', '1', '2']);
  });

  it('compares text case-insensitively', () => {
    expect(ids('name', 'asc')).toEqual(['2', '3', '1']);
  });

  it('keeps equal keys in their original order (stable)', () => {
    // "Alpha" and "alpha" tie, so row 1 must stay ahead of row 3.
    expect(ids('supplier', 'asc')).toEqual(['1', '3', '2']);
  });

  it('does not mutate the caller array', () => {
    const snapshot = rows.map((row) => row.id);
    sortInventoryRows(rows, 'stock', 'desc');
    expect(rows.map((row) => row.id)).toEqual(snapshot);
  });
});

describe('defaultSortDirection', () => {
  it('starts money and stock high-first', () => {
    expect(defaultSortDirection('price')).toBe('desc');
    expect(defaultSortDirection('cost')).toBe('desc');
    expect(defaultSortDirection('stock')).toBe('desc');
  });

  it('starts text columns A to Z', () => {
    expect(defaultSortDirection('name')).toBe('asc');
    expect(defaultSortDirection('category')).toBe('asc');
    expect(defaultSortDirection('supplier')).toBe('asc');
  });
});
