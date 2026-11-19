import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vitest';
import { translate } from '../translate';

function sqlLiterals(file: string) {
  const source = ts.createSourceFile(file, readFileSync(path.join(process.cwd(), file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const constants = new Map<string, string>();
  const statements: string[] = [];
  const textOf = (node: ts.Node): string | null => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isIdentifier(node)) return constants.get(node.text) ?? null;
    if (ts.isTemplateExpression(node)) {
      let text = node.head.text;
      for (const span of node.templateSpans) {
        const fragment = textOf(span.expression);
        if (fragment === null) return null;
        text += fragment + span.literal.text;
      }
      return text;
    }
    return null;
  };
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const text = textOf(node.initializer);
      if (text !== null) constants.set(node.name.text, text);
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      const text = textOf(node);
      if (text && /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\s/i.test(text)) statements.push(text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { constants, statements };
}

describe('phase A/B/C SQL against the current tenant schema', () => {
  it('prepares page/write queries and executes composed PO projections with persisted discounts', async () => {
    const client = createClient({ url: 'file::memory:' });
    try {
      await client.executeMultiple(readFileSync(path.join(process.cwd(), 'db/schema/tenant.sql'), 'utf8'));
      let count = 0;
      for (const file of [
        'src/components/inventory/PurchaseOrderPanel.tsx', 'src/pages/BranchTransfers.tsx',
        'src/pages/BranchOrders.tsx', 'src/lib/goods-receipt.ts',
      ]) {
        for (const sql of sqlLiterals(file).statements) {
          const prepared = translate(sql, Array(30).fill(null));
          await expect(client.execute({ sql: `EXPLAIN ${prepared.sql}`, args: prepared.args as never }), sql).resolves.toBeDefined();
          count++;
        }
      }
      expect(count).toBeGreaterThan(30);
      await client.executeMultiple(`
        INSERT INTO suppliers (id, name) VALUES ('vendor', 'Vendor');
        INSERT INTO warehouses (id, name, type) VALUES ('wh', 'Warehouse', 'central');
        INSERT INTO products (id, name, sku) VALUES ('product', 'Milk', 'MILK');
        INSERT INTO purchase_orders (id, po_number, supplier_id, warehouse_id, subtotal_amount, discount_type, discount_value, discount_amount, ppn_rate, ppn_amount, total_amount)
          VALUES ('po', 'PO-SQL', 'vendor', 'wh', 1000, 'percent', 10, 100, 11, 99, 999);
        INSERT INTO purchase_order_items (id, purchase_order_id, product_id, quantity, unit_cost, subtotal, quantity_received)
          VALUES ('poi', 'po', 'product', 1, 1000, 1000, 0.5);
        INSERT INTO goods_receipts (id, grn_number, purchase_order_id, warehouse_id, subtotal_amount, discount_amount, ppn_rate, ppn_amount, total_amount)
          VALUES ('gr', 'GR-SQL', 'po', 'wh', 500, 50, 11, 50, 500);
        INSERT INTO goods_receipt_items (goods_receipt_id, purchase_order_item_id, product_id, quantity, unit_cost, subtotal)
          VALUES ('gr', 'poi', 'product', 0.5, 1000, 500);
      `);
      const { constants } = sqlLiterals('src/components/inventory/PurchaseOrderPanel.tsx');
      for (const name of ['PO_LIST_SQL', 'PO_HEADER_SQL']) {
        const prepared = translate(constants.get(name)!, ['po']);
        const result = await client.execute({ sql: prepared.sql, args: prepared.args as never });
        expect(result.rows[0]).toMatchObject({ discount_type: 'percent', discount_value: 10, discount_amount: 100, total_amount: 999 });
      }
      const prepared = translate(constants.get('RECEIPT_LINES_SQL')!, ['po']);
      expect((await client.execute({ sql: prepared.sql, args: prepared.args as never })).rows[0])
        .toMatchObject({ previous_value: 500, previous_subtotal: 500, already_received: 0.5 });
    } finally { client.close(); }
  });
});
