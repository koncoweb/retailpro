
import { describe, expect, it } from 'vitest';
import {
  generateNextSku,
  mintSkuForCategory,
  skuPrefixForCategory,
  validateBarcode,
  type SkuSequenceReader,
} from './inventory-utils';

describe('Inventory Utils', () => {
  describe('generateNextSku', () => {
    const fixedDate = new Date('2023-10-25T10:00:00Z'); // 2023-10-25

    it('should generate the first SKU for a new category', () => {
      const sku = generateNextSku('Electronics', fixedDate, null);
      // ELE-20231025-001
      expect(sku).toBe('ELE-20231025-001');
    });

    it('should increment sequence from the last SKU', () => {
      const lastSku = 'ELE-20231025-005';
      const sku = generateNextSku('Electronics', fixedDate, lastSku);
      expect(sku).toBe('ELE-20231025-006');
    });

    it('should handle category names shorter than 3 chars', () => {
      const sku = generateNextSku('TV', fixedDate, null);
      // TVX-20231025-001 (padded with X)
      expect(sku).toBe('TVX-20231025-001');
    });

    it('should handle special characters in category name', () => {
      // "F&B" -> "F&B" is not alphanumeric -> replace non-alphanum?
      // Logic: replace(/[^A-Z0-9]/g, "CAT")
      // F&B -> F(CAT)B ? No, substring(0,3) first.
      // "F&B" -> "F&B" -> F, &, B.
      // Replace non-alphanum with CAT?
      // "F&B" -> F CAT B? No, the regex is replace global on the substring.
      // "F&B" -> 'F' (ok), '&' (replace CAT), 'B' (ok) -> FCATB ? 
      // Wait, let's check the implementation: 
      // prefix = categoryName.substring(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "CAT");
      // "F&B" -> substring(0,3) is "F&B".
      // "F" -> F
      // "&" -> CAT
      // "B" -> B
      // Result: FCATB. Length 5.
      
      const sku = generateNextSku('F&B', fixedDate, null);
      expect(sku).toContain('FCATB');
    });
    
    it('should throw error if category name is empty', () => {
        expect(() => generateNextSku('', fixedDate)).toThrow();
    });
  });

  describe('validateBarcode', () => {
      it('should return true for valid alphanumeric barcode', () => {
          expect(validateBarcode('1234567890123')).toBe(true);
          expect(validateBarcode('ABC-123')).toBe(true);
      });

      it('should return false for empty barcode', () => {
          expect(validateBarcode('')).toBe(false);
      });
  });

  describe('mintSkuForCategory', () => {
    const today = new Date('2023-10-25T10:00:00Z');
    const prefix = skuPrefixForCategory('Minuman', today); // MIN-20231025-

    /** The one query the minter is allowed to make, replayed from a fixture. */
    function readerFor(stored: string[], calls: Array<{ sql: string; params?: unknown[] }> = []): SkuSequenceReader {
      return {
        async query<T = { sku: string }>(sql: string, params?: unknown[]) {
          calls.push({ sql, params });
          return { rows: stored.map((sku) => ({ sku })) as unknown as T[] };
        },
      };
    }

    it('starts the sequence when the category has no SKU yet', async () => {
      await expect(mintSkuForCategory(readerFor([]), 'Minuman', today)).resolves.toBe(
        'MIN-20231025-001'
      );
    });

    it('continues the sequence stored in the database', async () => {
      await expect(
        mintSkuForCategory(readerFor(['MIN-20231025-007']), 'Minuman', today)
      ).resolves.toBe('MIN-20231025-008');
    });

    it('beats a stale read with the numbers already handed out in this run', async () => {
      // A planned batch has not written its rows yet, so the database cannot
      // answer for them: `seen` is the only thing preventing two lines of one
      // file from claiming the same code.
      await expect(
        mintSkuForCategory(readerFor(['MIN-20231025-007']), 'Minuman', today, [
          'MIN-20231025-012',
        ])
      ).resolves.toBe('MIN-20231025-013');
    });

    it('ignores minted codes from another category', async () => {
      await expect(
        mintSkuForCategory(readerFor([]), 'Minuman', today, ['SNK-20231025-099'])
      ).resolves.toBe('MIN-20231025-001');
    });

    it('asks only for the category prefix', async () => {
      const calls: Array<{ sql: string; params?: unknown[] }> = [];
      await mintSkuForCategory(readerFor([], calls), 'Minuman', today);
      expect(calls).toHaveLength(1);
      expect(calls[0].sql).toContain('LIKE $1');
      expect(calls[0].params).toEqual([`${prefix}%`]);
    });

    it('falls back to a generic category instead of throwing on a blank one', async () => {
      // generateNextSku('') throws; a sheet with an empty Kategori column must
      // still get a code, because the row is otherwise perfectly importable.
      await expect(mintSkuForCategory(readerFor([]), '', today)).resolves.toBe(
        'UMU-20231025-001'
      );
      await expect(mintSkuForCategory(readerFor([]), null, today)).resolves.toBe(
        'UMU-20231025-001'
      );
    });
  });
});
