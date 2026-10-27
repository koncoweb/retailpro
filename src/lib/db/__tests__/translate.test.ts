import { describe, expect, it } from 'vitest';
import { hasPostgresPlaceholders, translate } from '../translate';

describe('translate', () => {
  it('leaves a statement without placeholders untouched', () => {
    const { sql, args } = translate('SELECT 1');
    expect(sql).toBe('SELECT 1');
    expect(args).toEqual([]);
  });

  it('rewrites $n to ? and expands params in order', () => {
    const { sql, args } = translate('SELECT * FROM users WHERE email = $1 AND id = $2', [
      'a@b.c',
      'u-1',
    ]);
    expect(sql).toBe('SELECT * FROM users WHERE email = ? AND id = ?');
    expect(args).toEqual(['a@b.c', 'u-1']);
  });

  it('duplicates a repeated placeholder (POS.tsx checkout statement)', () => {
    const { sql, args } = translate(
      `INSERT INTO transactions (a, b, c, d, e, f) VALUES ($1, $2, $3, $4, $5, 'completed', $4, $6)`,
      ['a', 'b', 'c', 4, 'e', 'f']
    );
    expect(sql).toBe(
      `INSERT INTO transactions (a, b, c, d, e, f) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)`
    );
    expect(args).toEqual(['a', 'b', 'c', 4, 'e', 4, 'f']);
  });

  it('does not touch placeholders inside single-quoted literals', () => {
    const { sql, args } = translate(`SELECT '$1 is not a param' AS x, $1 AS y`, ['v']);
    expect(sql).toBe(`SELECT '$1 is not a param' AS x, ? AS y`);
    expect(args).toEqual(['v']);
  });

  it('handles doubled single quotes (escaped apostrophes)', () => {
    const { sql } = translate(`SELECT 'it''s $1 fine' AS x`);
    expect(sql).toBe(`SELECT 'it''s $1 fine' AS x`);
  });

  it('keeps apostrophes in Indonesian literals intact', () => {
    const { sql, args } = translate(`INSERT INTO expenses (category) VALUES ('Pembelian Stok', $1)`, [
      10,
    ]);
    expect(sql).toBe(`INSERT INTO expenses (category) VALUES ('Pembelian Stok', ?)`);
    expect(args).toEqual([10]);
  });

  it('does not touch placeholders inside double-quoted identifiers', () => {
    const { sql } = translate(`SELECT "col$1" FROM t`);
    expect(sql).toBe(`SELECT "col$1" FROM t`);
  });

  it('ignores placeholders inside line comments', () => {
    const { sql, args } = translate(`SELECT $1 -- $2 is a comment\nFROM t`, ['v']);
    expect(sql).toBe(`SELECT ? -- $2 is a comment\nFROM t`);
    expect(args).toEqual(['v']);
  });

  it('ignores placeholders inside block comments', () => {
    const { sql, args } = translate(`SELECT $1 /* $2 ignored */ FROM t`, ['v']);
    expect(sql).toBe(`SELECT ? /* $2 ignored */ FROM t`);
    expect(args).toEqual(['v']);
  });

  it('reads multi-digit placeholders', () => {
    const params = Array.from({ length: 11 }, (_, i) => i + 1);
    const { sql, args } = translate(`SELECT $11, $1`, params);
    expect(sql).toBe(`SELECT ?, ?`);
    expect(args).toEqual([11, 1]);
  });

  it('passes params through untouched when the statement already uses ?', () => {
    const { sql, args } = translate('INSERT INTO categories (name) VALUES (?)', ['Minuman']);
    expect(sql).toBe('INSERT INTO categories (name) VALUES (?)');
    expect(args).toEqual(['Minuman']);
  });

  it('throws when a placeholder has no parameter', () => {
    expect(() => translate(`SELECT $2`, ['only-one'])).toThrow(/\$2 has no matching parameter/);
  });

  it('throws on $0 because placeholders are 1-based', () => {
    expect(() => translate(`SELECT $0`, ['x'])).toThrow(/placeholders are 1-based/);
  });
});

describe('hasPostgresPlaceholders', () => {
  it('is true for $n statements', () => {
    expect(hasPostgresPlaceholders('SELECT $1')).toBe(true);
  });

  it('is false for statements that are already SQLite syntax', () => {
    expect(hasPostgresPlaceholders('SELECT ?')).toBe(false);
  });
});
