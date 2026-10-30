/**
 * The procurement rules, tested without a database.
 *
 * Everything here is a pure function, so the assertions can be read as the
 * spec's §4 table, §5 numbering and §6 guards written out a second time. If a
 * screen ever disagrees with this file, the screen is wrong.
 */
import { describe, expect, it } from 'vitest';
import {
  actionsForPurchaseOrder,
  canPerformPurchaseAction,
  checkApprovalRights,
  derivePurchaseOrderStatus,
  documentNumberPrefix,
  effectiveReceivedAmount,
  formatDocumentNumber,
  isFullyReceived,
  nextDocumentSequence,
  normalizePurchaseOrderStatus,
  PO_STATUS_LABEL,
  remainingQuantity,
  roleHasPurchasePermission,
  validatePurchaseOrder,
  validateReceipt,
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderStatus,
} from './procurement';

const allowAll = () => true;
const denyAll = () => false;

/** The §4 verbs for a status; `view` is not a transition, so it is dropped. */
const verbs = (status: PurchaseOrderStatus) =>
  actionsForPurchaseOrder(status, allowAll).filter((action) => action !== 'view');

describe('purchase orders: actions per status', () => {
  it('offers exactly what the state machine allows', () => {
    expect(verbs('draft')).toEqual(['edit', 'submit', 'cancel', 'delete']);
    expect(verbs('submitted')).toEqual(['approve', 'reject', 'cancel']);
    expect(verbs('approved')).toEqual(['receive', 'cancel']);
    expect(verbs('partially_received')).toEqual(['receive']);
    // A finished document can only be copied into a new draft.
    expect(verbs('received')).toEqual(['duplicate']);
    expect(verbs('rejected')).toEqual(['duplicate']);
    expect(verbs('cancelled')).toEqual(['duplicate']);
  });

  it('never lets a missing permission through', () => {
    // `view` carries no permission, so reading is always available.
    expect(actionsForPurchaseOrder('submitted', denyAll)).toEqual(['view']);
    expect(canPerformPurchaseAction('submitted', 'view', denyAll)).toBe(true);
    expect(canPerformPurchaseAction('submitted', 'approve', denyAll)).toBe(false);
    // And a permission does not open a status the machine forbids.
    expect(canPerformPurchaseAction('draft', 'approve', allowAll)).toBe(false);
    expect(canPerformPurchaseAction('received', 'receive', allowAll)).toBe(false);
  });

  it('labels every status and folds `ordered` into `approved`', () => {
    for (const status of PURCHASE_ORDER_STATUSES) {
      expect(PO_STATUS_LABEL[status]).toBeTruthy();
    }
    expect(normalizePurchaseOrderStatus('ordered')).toBe('approved');
    expect(normalizePurchaseOrderStatus(null)).toBe('draft');
    expect(normalizePurchaseOrderStatus('something_else')).toBe('draft');
  });
});

describe('purchase orders: approval rights', () => {
  it('lets an owner sign their own order but not an admin', () => {
    expect(checkApprovalRights({ role: 'tenant_owner', actorId: 'u1', createdBy: 'u1' })).toBeNull();
    expect(checkApprovalRights({ role: 'platform_owner', actorId: 'u1', createdBy: 'u1' })).toBeNull();
    expect(checkApprovalRights({ role: 'tenant_admin', actorId: 'u1', createdBy: 'u1' })).toContain(
      'Anda buat sendiri'
    );
    expect(checkApprovalRights({ role: 'store_manager', actorId: 'u1', createdBy: 'u1' })).toContain(
      'Anda buat sendiri'
    );
  });

  it('allows anyone else to approve, and refuses an unknown session', () => {
    expect(checkApprovalRights({ role: 'tenant_admin', actorId: 'u2', createdBy: 'u1' })).toBeNull();
    // An order with no recorded creator is not a self-approval.
    expect(checkApprovalRights({ role: 'tenant_admin', actorId: 'u2', createdBy: null })).toContain(
      'Anda buat sendiri'
    );
    expect(checkApprovalRights({ role: 'tenant_owner', actorId: null, createdBy: 'u1' })).toContain(
      'Sesi tidak dikenali'
    );
  });

  it('separates raising from approving by role', () => {
    expect(roleHasPurchasePermission('purchasing', 'create_po')).toBe(true);
    expect(roleHasPurchasePermission('purchasing', 'approve_po')).toBe(false);
    expect(roleHasPurchasePermission('store_manager', 'create_po')).toBe(true);
    expect(roleHasPurchasePermission('store_manager', 'approve_po')).toBe(false);
    expect(roleHasPurchasePermission('warehouse', 'receive_po')).toBe(true);
    expect(roleHasPurchasePermission('warehouse', 'create_po')).toBe(false);
    expect(roleHasPurchasePermission('tenant_owner', 'approve_po')).toBe(true);
    // The legacy `admin` column means `tenant_admin`.
    expect(roleHasPurchasePermission('admin', 'approve_po')).toBe(true);
    expect(roleHasPurchasePermission(null, 'create_po')).toBe(false);
  });
});

describe('purchase orders: quantities', () => {
  it('reports what is still owed, and never a negative', () => {
    expect(remainingQuantity({ quantity: 10, quantity_received: 0 })).toBe(10);
    expect(remainingQuantity({ quantity: 10, quantity_received: 4 })).toBe(6);
    expect(remainingQuantity({ quantity: 10, quantity_received: 10 })).toBe(0);
    expect(remainingQuantity({ quantity: 10, quantity_received: 12 })).toBe(0);
    expect(remainingQuantity({ quantity: 10 })).toBe(10);
  });

  it('derives the status from the lines, not from the caller', () => {
    expect(derivePurchaseOrderStatus([{ quantity: 10, quantity_received: 0 }], 'approved')).toBe(
      'approved'
    );
    expect(derivePurchaseOrderStatus([{ quantity: 10, quantity_received: 4 }], 'approved')).toBe(
      'partially_received'
    );
    expect(derivePurchaseOrderStatus([{ quantity: 10, quantity_received: 10 }], 'approved')).toBe(
      'received'
    );
    expect(
      derivePurchaseOrderStatus(
        [
          { quantity: 10, quantity_received: 10 },
          { quantity: 5, quantity_received: 5 },
        ],
        'partially_received'
      )
    ).toBe('received');
  });

  it('treats a third of a unit three times as the whole unit', () => {
    // 0.1 + 0.1 + 0.1 !== 0.3 in binary floating point; a REAL column makes
    // that the normal case for a bakery, not an edge case.
    const lines = [{ quantity: 0.3, quantity_received: 0.1 + 0.1 + 0.1 }];
    expect(isFullyReceived(lines)).toBe(true);
    expect(derivePurchaseOrderStatus(lines, 'approved')).toBe('received');
  });

  it('leaves a document it did not receive untouched', () => {
    expect(derivePurchaseOrderStatus([{ quantity: 10, quantity_received: 0 }], 'draft')).toBe('draft');
    expect(derivePurchaseOrderStatus([{ quantity: 10, quantity_received: 0 }], 'cancelled')).toBe(
      'cancelled'
    );
    // An empty order is not "fully received".
    expect(isFullyReceived([])).toBe(false);
  });
});

describe('purchase orders: editor guards', () => {
  const line = {
    productId: 'p1',
    quantity: 2,
    unitName: 'Pcs',
    conversionFactor: 1,
    unitCost: 5000,
  };
  const base = { supplierId: 'v1', destinationWarehouseId: 'w1', items: [line] };

  it('accepts a complete order', () => {
    expect(validatePurchaseOrder(base, '2026-10-30')).toBeNull();
    expect(validatePurchaseOrder({ ...base, expectedDate: '2026-11-02' }, '2026-10-30')).toBeNull();
  });

  it('names the first thing that is missing', () => {
    expect(validatePurchaseOrder({ ...base, supplierId: null }, '2026-10-30')).toContain('vendor');
    expect(validatePurchaseOrder({ ...base, destinationWarehouseId: '' }, '2026-10-30')).toContain(
      'gudang'
    );
    expect(validatePurchaseOrder({ ...base, items: [] }, '2026-10-30')).toContain('1 produk');
  });

  it('rejects a quantity or a price the ledger cannot hold', () => {
    expect(
      validatePurchaseOrder({ ...base, items: [{ ...line, quantity: 0 }] }, '2026-10-30')
    ).toContain('lebih dari 0');
    expect(
      validatePurchaseOrder({ ...base, items: [{ ...line, quantity: 0.0001 }] }, '2026-10-30')
    ).toContain('3 angka');
    expect(
      validatePurchaseOrder({ ...base, items: [{ ...line, unitCost: -1 }] }, '2026-10-30')
    ).toContain('Harga satuan');
    expect(
      validatePurchaseOrder({ ...base, items: [{ ...line, conversionFactor: 0 }] }, '2026-10-30')
    ).toContain('Konversi');
    // Half a unit is a normal bakery order.
    expect(
      validatePurchaseOrder({ ...base, items: [{ ...line, quantity: 0.5 }] }, '2026-10-30')
    ).toBeNull();
  });

  it('refuses an expected date in the past', () => {
    expect(validatePurchaseOrder({ ...base, expectedDate: '2026-10-29' }, '2026-10-30')).toContain(
      'masa lalu'
    );
  });
});

describe('purchase orders: receipt guards', () => {
  const line = {
    purchaseOrderItemId: 'i1',
    quantity: 4,
    ordered: 10,
    alreadyReceived: 6,
    unitCost: 5000,
    unitName: 'Pcs',
  };
  const options = { receivedOn: '2026-10-30', requireExpiry: false };

  it('accepts exactly the remaining quantity', () => {
    expect(validateReceipt([line], options)).toBeNull();
    expect(validateReceipt([{ ...line, quantity: 6 }], options)).toContain('melebihi sisa');
  });

  it('needs at least one delivered line', () => {
    expect(validateReceipt([{ ...line, quantity: 0 }], options)).toContain('minimal satu baris');
    expect(validateReceipt([], options)).toContain('minimal satu baris');
  });

  it('asks for an expiry date only when the tenant picks FEFO', () => {
    expect(validateReceipt([line], { receivedOn: '2026-10-30', requireExpiry: true })).toContain(
      'FEFO'
    );
    expect(
      validateReceipt([{ ...line, expiryDate: '2026-10-30' }], {
        receivedOn: '2026-10-30',
        requireExpiry: true,
      })
    ).toContain('setelah');
    expect(
      validateReceipt([{ ...line, expiryDate: '2026-12-31' }], {
        receivedOn: '2026-10-30',
        requireExpiry: true,
      })
    ).toBeNull();
    // FIFO/LIFO: a lot number without a date is fine.
    expect(validateReceipt([line], options)).toBeNull();
  });

  it('rejects a negative or non-numeric quantity', () => {
    expect(validateReceipt([{ ...line, quantity: -1 }], options)).toContain('tidak valid');
    expect(validateReceipt([{ ...line, quantity: Number.NaN }], options)).toContain('tidak valid');
  });
});

describe('purchase orders: document numbering', () => {
  const day = new Date('2026-10-30T09:15:00Z');

  it('formats PREFIX-YYYYMMDD-NNNN from 0001', () => {
    expect(documentNumberPrefix('PO', day)).toBe('PO-20261030-');
    expect(formatDocumentNumber('PO', day, 1)).toBe('PO-20261030-0001');
    expect(formatDocumentNumber('GRN', day, 42)).toBe('GRN-20261030-0042');
  });

  it('continues from the highest number of the same day', () => {
    expect(nextDocumentSequence('PO', day, [])).toBe(1);
    expect(nextDocumentSequence('PO', day, ['PO-20261030-0001', 'PO-20261030-0007'])).toBe(8);
    // A gap (a deleted draft) must not hand out a duplicate.
    expect(nextDocumentSequence('PO', day, ['PO-20261030-0007', 'PO-20261030-0003'])).toBe(8);
  });

  it('starts over on a new day and ignores legacy numbers', () => {
    expect(
      nextDocumentSequence('PO', day, ['PO-20261029-0009', 'PO/2026/0015', 'GRN-20261030-0004'])
    ).toBe(1);
    expect(nextDocumentSequence('GRN', day, ['PO-20261030-0009'])).toBe(1);
    expect(nextDocumentSequence('PO', day, [null, undefined, 'PO-20261030-abc'])).toBe(1);
  });

  it('keeps each status typed so a stray string cannot leak in', () => {
    const statuses: PurchaseOrderStatus[] = [...PURCHASE_ORDER_STATUSES];
    expect(statuses).toHaveLength(7);
    expect(statuses as string[]).not.toContain('ordered');
  });
});

describe('effectiveReceivedAmount', () => {
  it('reports the receipt total while an order is still arriving', () => {
    expect(
      effectiveReceivedAmount({
        status: 'partially_received',
        total_amount: 125_000,
        received_amount: 75_000,
      })
    ).toBe(75_000);
    expect(
      effectiveReceivedAmount({ status: 'approved', total_amount: 125_000, received_amount: 0 })
    ).toBe(0);
  });

  it('shows what arrived when a full receipt exists', () => {
    expect(
      effectiveReceivedAmount({
        status: 'received',
        total_amount: 125_000,
        received_amount: 125_000,
      })
    ).toBe(125_000);
  });

  it('falls back to the order total for an order the old code received in one step', () => {
    // Migration 005 could not invent receipt documents for these, so the
    // receipt sum is 0 even though the goods are on the shelf.
    expect(
      effectiveReceivedAmount({ status: 'received', total_amount: 568_000, received_amount: 0 })
    ).toBe(568_000);
  });

  it('understands the retired `ordered` status', () => {
    expect(
      effectiveReceivedAmount({ status: 'ordered', total_amount: 100_000, received_amount: 40_000 })
    ).toBe(40_000);
  });
});
