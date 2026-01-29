
import { describe, it, expect } from 'vitest';
import { generateNextSku, validateBarcode } from './inventory-utils';

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
});
