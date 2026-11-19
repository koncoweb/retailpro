import { describe, expect, it } from 'vitest';
import {
  alignToGroups,
  expandCombinations,
  formatAttributeCell,
  mergeGroups,
  orderedValues,
  parseAttributeCell,
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

describe('mergeGroups', () => {
  it('appends a new value to the stored axis and keeps its order', () => {
    expect(
      mergeGroups(
        [{ name: 'Rasa', values: ['Susu', 'Hitam'] }],
        [{ name: 'Rasa', values: ['Susu', 'Matcha'] }]
      )
    ).toEqual([{ name: 'Rasa', values: ['Susu', 'Hitam', 'Matcha'] }]);
  });

  it('never removes a stored value, even when the sheet drops it', () => {
    // A variant that still sells or holds stock references the value, and an
    // import has no licence to break it.
    expect(
      mergeGroups([{ name: 'Rasa', values: ['Susu', 'Hitam'] }], [
        { name: 'Rasa', values: ['Susu'] },
      ])
    ).toEqual([{ name: 'Rasa', values: ['Susu', 'Hitam'] }]);
  });

  it('adds a brand-new axis at the end and matches names case-insensitively', () => {
    expect(
      mergeGroups([{ name: 'Rasa', values: ['Susu'] }], [
        { name: 'rasa', values: ['Hitam'] },
        { name: 'Ukuran', values: ['250ml'] },
      ])
    ).toEqual([
      { name: 'Rasa', values: ['Susu', 'Hitam'] },
      { name: 'Ukuran', values: ['250ml'] },
    ]);
  });

  it('does not mutate the stored list it was handed', () => {
    const stored = [{ name: 'Rasa', values: ['Susu'] }];
    mergeGroups(stored, [{ name: 'Rasa', values: ['Hitam'] }]);
    expect(stored).toEqual([{ name: 'Rasa', values: ['Susu'] }]);
  });
});

describe('the sheet attribute cell', () => {
  it('reads every separator an operator is likely to type', () => {
    for (const cell of [
      'Rasa=Susu;Ukuran=250ml',
      'Rasa=Susu|Ukuran=250ml',
      'Rasa=Susu\nUkuran=250ml',
      'Rasa:Susu;Ukuran:250ml',
      ' Rasa = Susu ; Ukuran = 250ml ',
    ]) {
      expect(parseAttributeCell(cell)).toEqual({ Rasa: 'Susu', Ukuran: '250ml' });
    }
  });

  it('treats blank, dash and Default as "this product has no axes"', () => {
    expect(parseAttributeCell('')).toEqual({});
    expect(parseAttributeCell('Default')).toEqual({});
    expect(parseAttributeCell('DEFAULT')).toEqual({});
    expect(parseAttributeCell('-')).toEqual({});
    expect(parseAttributeCell(null)).toEqual({});
  });

  it('keeps the order of first appearance as the axis order', () => {
    expect(Object.keys(parseAttributeCell('Ukuran=250ml;Rasa=Susu'))).toEqual([
      'Ukuran',
      'Rasa',
    ]);
  });

  it('writes what it can read back, in the authored axis order', () => {
    const groups = [
      { name: 'Rasa', values: ['Susu', 'Hitam'] },
      { name: 'Ukuran', values: ['250ml'] },
    ];
    const cell = formatAttributeCell({ Ukuran: '250ml', Rasa: 'Hitam' }, groups);
    expect(cell).toBe('Rasa=Hitam;Ukuran=250ml');
    expect(parseAttributeCell(cell)).toEqual({ Rasa: 'Hitam', Ukuran: '250ml' });
  });

  it('still exports an axis the groups no longer mention', () => {
    // Export has to write the variant a customer is holding, not the axes the
    // product happens to advertise today, or the round trip loses a column.
    expect(formatAttributeCell({ Rasa: 'Susu', Warna: 'Merah' }, [
      { name: 'Rasa', values: ['Susu'] },
    ])).toBe('Rasa=Susu;Warna=Merah');
  });

  it('renders a product without axes as an empty cell', () => {
    expect(formatAttributeCell({})).toBe('');
  });
});
