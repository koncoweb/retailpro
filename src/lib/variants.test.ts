import { describe, expect, it } from 'vitest';
import {
  alignToGroups,
  expandCombinations,
  orderedValues,
  parseVariantAttributes,
  parseVariantGroups,
  sanitizeGroups,
  variantKey,
  variantLabel,
  variantSku,
} from './variants';

describe('expandCombinations', () => {
  it('returns nothing for a product without attribute groups', () => {
    expect(expandCombinations([])).toEqual([]);
  });

  it('returns one combination per value for a single group', () => {
    const combos = expandCombinations([{ name: 'Rasa', values: ['Susu', 'Hitam'] }]);
    expect(combos).toEqual([{ Rasa: 'Susu' }, { Rasa: 'Hitam' }]);
  });

  it('builds the cartesian product in a stable odometer order', () => {
    const combos = expandCombinations([
      { name: 'Rasa', values: ['Susu', 'Hitam'] },
      { name: 'Ukuran', values: ['250ml', '1L'] },
    ]);
    expect(combos).toEqual([
      { Rasa: 'Susu', Ukuran: '250ml' },
      { Rasa: 'Susu', Ukuran: '1L' },
      { Rasa: 'Hitam', Ukuran: '250ml' },
      { Rasa: 'Hitam', Ukuran: '1L' },
    ]);
  });

  it('drops a group with no usable value so it cannot erase the product', () => {
    const combos = expandCombinations([
      { name: 'Rasa', values: ['Susu'] },
      { name: 'Warna', values: [] },
    ]);
    expect(combos).toEqual([{ Rasa: 'Susu' }]);
  });
});

describe('sanitizeGroups', () => {
  it('trims names and values, and removes case-duplicate values', () => {
    const groups = sanitizeGroups([
      { name: ' Rasa ', values: ['Susu', 'susu', ' ', 'Hitam'] },
    ]);
    expect(groups).toEqual([{ name: 'Rasa', values: ['Susu', 'Hitam'] }]);
  });
});

describe('variantLabel', () => {
  it('says Default when nothing was chosen', () => {
    expect(variantLabel({})).toBe('Default');
  });

  it('orders values by the authored groups, not object order', () => {
    expect(
      variantLabel({ Ukuran: '250ml', Rasa: 'Susu' }, [
        { name: 'Rasa', values: ['Susu'] },
        { name: 'Ukuran', values: ['250ml'] },
      ])
    ).toBe('Susu 250ml');
  });

  it('keeps an attribute the groups no longer mention', () => {
    expect(orderedValues({ Rasa: 'Susu', Warna: 'Merah' }, [])).toEqual(['Susu', 'Merah']);
  });
});

describe('variantSku', () => {
  it('keeps the model SKU when there are no attributes', () => {
    expect(variantSku('KOP-20261031-001', {})).toBe('KOP-20261031-001');
  });

  it('appends a slug of every attribute value', () => {
    expect(variantSku('KOP-1', { Rasa: 'Susu', Ukuran: '250ml' })).toBe('KOP-1-SUSU-250ML');
  });

  it('produces a different SKU for two combinations of the same product', () => {
    const a = variantSku('KOP-1', { Rasa: 'Susu' });
    const b = variantSku('KOP-1', { Rasa: 'Hitam' });
    expect(a).not.toBe(b);
  });
});

describe('variantKey', () => {
  it('ignores group order and letter case', () => {
    expect(variantKey({ Rasa: 'Susu', Ukuran: '250ml' })).toBe(
      variantKey({ Ukuran: '250ML', Rasa: 'susu' })
    );
  });

  it('ignores blank attributes', () => {
    expect(variantKey({ Rasa: 'Susu', Warna: '' })).toBe('rasa=susu');
  });
});

describe('alignToGroups', () => {
  it('adds a newly authored group with an empty value', () => {
    expect(
      alignToGroups({ Rasa: 'Susu' }, [
        { name: 'Rasa', values: ['Susu'] },
        { name: 'Ukuran', values: ['250ml'] },
      ])
    ).toEqual({ Rasa: 'Susu', Ukuran: '' });
  });
});

describe('parsing stored JSON', () => {
  it('parses variant attributes from text', () => {
    expect(parseVariantAttributes('{"Rasa":"Susu"}')).toEqual({ Rasa: 'Susu' });
  });

  it('survives malformed attribute JSON', () => {
    expect(parseVariantAttributes('not json')).toEqual({});
    expect(parseVariantAttributes(null)).toEqual({});
  });

  it('parses groups and drops values that are not strings', () => {
    expect(parseVariantGroups('[{"name":"Rasa","values":["Susu",3]}]')).toEqual([
      { name: 'Rasa', values: ['Susu'] },
    ]);
  });

  it('returns no groups for a legacy empty column', () => {
    expect(parseVariantGroups('[]')).toEqual([]);
    expect(parseVariantGroups(undefined)).toEqual([]);
  });
});
