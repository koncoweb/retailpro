import { describe, expect, it } from 'vitest';
import {
  CANONICAL_UNITS,
  typicalFactorsFor,
  unitLabel,
  unitNameOptions,
} from './units';

describe('unitLabel', () => {
  it('describes a bulk case by its contents', () => {
    expect(unitLabel('Karton', 40, 'Pcs')).toBe('Isi 40 Pcs');
  });

  it('returns nothing for the base unit so a Pcs row stays clean', () => {
    expect(unitLabel('Pcs', 1, 'Pcs')).toBe('');
  });

  it('treats a non-finite or sub-one factor as the base unit', () => {
    expect(unitLabel('Pcs', 0, 'Pcs')).toBe('');
    expect(unitLabel('Pcs', NaN, 'Pcs')).toBe('');
  });

  it('uses an Indonesian decimal comma for fractional quantities', () => {
    expect(unitLabel('Pack', 12.5, 'Isi')).toBe('Isi 12,5 Isi');
  });

  it('falls back to a bare count when the base name is unknown', () => {
    expect(unitLabel('Dus', 24, null)).toBe('Isi 24');
  });
});

describe('typicalFactorsFor', () => {
  it('suggests common case sizes for a known bulk unit', () => {
    expect(typicalFactorsFor('Karton')).toContain(40);
  });

  it('matches case-insensitively and trimmed', () => {
    expect(typicalFactorsFor('  karton ')).toEqual(typicalFactorsFor('Karton'));
  });

  it('returns an empty list for an unknown or base unit', () => {
    expect(typicalFactorsFor('Pcs')).toEqual([]);
    expect(typicalFactorsFor('Keong')).toEqual([]);
  });
});

describe('CANONICAL_UNITS', () => {
  it('offers every name to a datalist', () => {
    expect(unitNameOptions()).toEqual(CANONICAL_UNITS.map((unit) => unit.name));
    expect(unitNameOptions()).toContain('Sachet');
  });

  it('has unique names', () => {
    const names = CANONICAL_UNITS.map((unit) => unit.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
