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
  lineSubtotal,
  nextDocumentSequence,
  normalizePpnRate,
  normalizePurchaseOrderStatus,
  PO_STATUS_LABEL,
  procurementAmounts,
  receiptProcurementAmounts,
  receiptLineSubtotal,
  validateProcurementDiscount,
  remainingQuantity,
  resolveDraftPpnRate,
  validatePurchaseOrder,
  vendorPpnRate,
  validateReceipt,
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderStatus,
} from './procurement';
import { buildGrants, grantForRole, makeChecker, type PermissionCheck } from './permission-matrix';

const allowAll = () => true;
const denyAll = () => false;
/** Holds only the approval right, so the self-approval rule is tested alone. */
const canApprove: PermissionCheck = (permission) => permission === 'approve_po';

/** The shipped matrix of a role, through the resolver the screens use. */
const asRole = (role: string): PermissionCheck =>
  makeChecker(grantForRole(buildGrants(null), role));

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
    expect(
      checkApprovalRights({ role: 'tenant_owner', actorId: 'u1', createdBy: 'u1', can: canApprove })
    ).toBeNull();
    expect(
      checkApprovalRights({
        role: 'platform_owner',
        actorId: 'u1',
        createdBy: 'u1',
        can: canApprove,
      })
    ).toBeNull();
    expect(
      checkApprovalRights({ role: 'tenant_admin', actorId: 'u1', createdBy: 'u1', can: canApprove })
    ).toContain('Anda buat sendiri');
    expect(
      checkApprovalRights({
        role: 'store_manager',
        actorId: 'u1',
        createdBy: 'u1',
        can: canApprove,
      })
    ).toContain('Anda buat sendiri');
  });

  it('asks the permission before the authorship', () => {
    // Separation of duties is meaningless for a role that cannot approve at all,
    // and the message has to say which of the two is missing.
    expect(
      checkApprovalRights({
        role: 'purchasing',
        actorId: 'u2',
        createdBy: 'u1',
        can: asRole('purchasing'),
      })
    ).toContain('tidak punya izin');
  });

  it('allows anyone else to approve, and refuses an unknown session', () => {
    expect(
      checkApprovalRights({ role: 'tenant_admin', actorId: 'u2', createdBy: 'u1', can: canApprove })
    ).toBeNull();
    // An order with no recorded creator is not a self-approval.
    expect(
      checkApprovalRights({
        role: 'tenant_admin',
        actorId: 'u2',
        createdBy: null,
        can: canApprove,
      })
    ).toContain('Anda buat sendiri');
    expect(
      checkApprovalRights({
        role: 'tenant_owner',
        actorId: null,
        createdBy: 'u1',
        can: canApprove,
      })
    ).toContain('Sesi tidak dikenali');
  });

  it('separates raising from approving by role', () => {
    expect(asRole('purchasing')('create_po')).toBe(true);
    expect(asRole('purchasing')('approve_po')).toBe(false);
    expect(asRole('store_manager')('create_po')).toBe(true);
    expect(asRole('store_manager')('approve_po')).toBe(false);
    expect(asRole('warehouse')('receive_po')).toBe(true);
    expect(asRole('warehouse')('create_po')).toBe(false);
    expect(asRole('tenant_owner')('approve_po')).toBe(true);
    // The legacy `admin` column means `tenant_admin`.
    expect(asRole('admin')('approve_po')).toBe(true);
    // An unknown role key — a custom role that was deleted — holds nothing.
    expect(asRole('cust_gone')('create_po')).toBe(false);
  });

  it('obeys an owner who moves the approval right to purchasing', () => {
    const grants = buildGrants({
      role_permissions: { purchasing: { approve_po: true } },
    });
    const buyer = makeChecker(grants['purchasing']);
    expect(buyer('approve_po')).toBe(true);
    expect(
      checkApprovalRights({ role: 'purchasing', actorId: 'u2', createdBy: 'u1', can: buyer })
    ).toBeNull();
    // …while the same owner can still take it back and close the step again.
    expect(
      checkApprovalRights({
        role: 'purchasing',
        actorId: 'u2',
        createdBy: 'u1',
        can: makeChecker(buildGrants({ role_permissions: { purchasing: { approve_po: false } } })['purchasing']),
      })
    ).toContain('tidak punya izin');
  });
});

describe('purchase orders: PPN amounts', () => {
  it('adds fixed 11% PPN to a tax-exclusive subtotal', () => {
    expect(procurementAmounts([{ quantity: 1, unitCost: 1_000_000 }], 11)).toMatchObject({
      subtotal: 1_000_000,
      ppnRate: 11,
      ppnAmount: 110_000,
      total: 1_110_000,
    });
  });

  it('keeps non-PPN and empty documents at their net amount', () => {
    expect(procurementAmounts([{ quantity: 2, unitCost: 12_500 }], 0)).toMatchObject({
      subtotal: 25_000,
      ppnRate: 0,
      ppnAmount: 0,
      total: 25_000,
    });
    expect(procurementAmounts([], 11)).toMatchObject({
      subtotal: 0,
      ppnRate: 11,
      ppnAmount: 0,
      total: 0,
    });
  });

  it('rounds each fractional line before calculating document PPN', () => {
    expect(lineSubtotal(0.333, 1_000)).toBe(333);
    expect(
      procurementAmounts(
        [
          { quantity: 0.333, unitCost: 1_000 },
          { quantity: 0.667, unitCost: 1_000 },
        ],
        11
      )
    ).toMatchObject({ subtotal: 1_000, ppnRate: 11, ppnAmount: 110, total: 1_110 });

    expect(procurementAmounts([{ quantity: 1, unitCost: 5 }], 11)).toMatchObject({
      subtotal: 5,
      ppnRate: 11,
      ppnAmount: 1,
      total: 6,
    });
  });

  it('normalizes vendor flags and unsupported stored rates', () => {
    expect(normalizePpnRate(11)).toBe(11);
    expect(normalizePpnRate(0)).toBe(0);
    expect(normalizePpnRate(10)).toBe(0);
    expect(normalizePpnRate(undefined)).toBe(0);
    expect(vendorPpnRate(true)).toBe(11);
    expect(vendorPpnRate(1)).toBe(11);
    expect(vendorPpnRate(false)).toBe(0);
    expect(vendorPpnRate(0)).toBe(0);
  });

  it('retains a same-vendor draft snapshot and adopts a switched vendor rate', () => {
    expect(
      resolveDraftPpnRate({
        savedSupplierId: 'vendor-a',
        savedPpnRate: 0,
        nextSupplierId: 'vendor-a',
        nextVendorPpnEnabled: 1,
      })
    ).toBe(0);
    expect(
      resolveDraftPpnRate({
        savedSupplierId: 'vendor-a',
        savedPpnRate: 11,
        nextSupplierId: 'vendor-b',
        nextVendorPpnEnabled: 0,
      })
    ).toBe(0);
    expect(
      resolveDraftPpnRate({
        nextSupplierId: 'vendor-b',
        nextVendorPpnEnabled: 1,
      })
    ).toBe(11);
  });
});

describe('purchase orders: discounts and receipt reconciliation', () => {
  it('applies one percentage or fixed discount before PPN', () => {
    const lines = [{ quantity: 2, unitCost: 500_000 }];
    const percent = procurementAmounts(lines, 11, { type: 'percent', value: 10 });
    expect(percent).toEqual({
      subtotal: 1_000_000, discountType: 'percent', discountValue: 10,
      discountAmount: 100_000, taxableAmount: 900_000, ppnRate: 11,
      ppnAmount: 99_000, total: 999_000,
    });
    expect(procurementAmounts(lines, 11, { type: 'amount', value: 100_000 }))
      .toMatchObject({ discountAmount: 100_000, taxableAmount: 900_000, total: 999_000 });
    expect(procurementAmounts(lines, 0, { type: 'percent', value: 100 }))
      .toMatchObject({ discountAmount: 1_000_000, taxableAmount: 0, ppnAmount: 0, total: 0 });
    expect(procurementAmounts(lines, 11)).toMatchObject({ discountType: 'none', discountValue: 0, discountAmount: 0 });
  });

  it('rejects invalid discounts and rounds percent discounts once', () => {
    for (const value of [-1, 101, NaN, Infinity]) {
      expect(validateProcurementDiscount({ type: 'percent', value }, 100)).not.toBeNull();
    }
    for (const value of [-1, 101, 0.1, NaN]) {
      expect(() => procurementAmounts([{ quantity: 1, unitCost: 100 }], 11, { type: 'amount', value })).toThrow();
    }
    expect(procurementAmounts([{ quantity: 1, unitCost: 5 }], 11, { type: 'percent', value: 10 }))
      .toMatchObject({ discountAmount: 1, taxableAmount: 4, ppnAmount: 0, total: 4 });
  });

  it('reconciles discount and PPN on three receipts, including the last rupiah', () => {
    let previousSubtotal = 0, previousDiscount = 0, previousPpn = 0;
    const discounts: number[] = [], taxes: number[] = [];
    for (let index = 1; index <= 3; index++) {
      const amounts = receiptProcurementAmounts([{ quantity: 1, unitCost: 5 }], 11, {
        poSubtotal: 15, poDiscountAmount: 2, cumulativeOrderedValue: index * 5,
        previousSubtotal, previousDiscount, previousPpn, finalReceipt: index === 3,
      });
      discounts.push(amounts.discountAmount); taxes.push(amounts.ppnAmount);
      previousSubtotal += amounts.subtotal; previousDiscount += amounts.discountAmount; previousPpn += amounts.ppnAmount;
    }
    expect(discounts).toEqual([1, 0, 1]);
    expect(taxes).toEqual([0, 1, 0]);
    expect(previousSubtotal - previousDiscount + previousPpn).toBe(14);
  });

  it('carries line rounding across fractional deliveries and price overrides', () => {
    expect(receiptLineSubtotal({ quantity: 0.333, unitCost: 5 })).toBe(2);
    expect(receiptLineSubtotal({ quantity: 0.333, unitCost: 5, previousValue: 1.665, previousSubtotal: 2 })).toBe(1);
    expect(receiptLineSubtotal({ quantity: 0.334, unitCost: 5, previousValue: 3.33, previousSubtotal: 3 })).toBe(2);
    expect(receiptLineSubtotal({ quantity: 0.334, unitCost: 6, previousValue: 3.33, previousSubtotal: 3 })).toBe(2);
    expect(receiptLineSubtotal({ quantity: 0, unitCost: 5, previousValue: 3.33, previousSubtotal: 3 })).toBe(0);
  });

  it('keeps the fixed PO discount when invoice prices change', () => {
    expect(receiptProcurementAmounts([{ quantity: 1, unitCost: 150 }], 11, {
      poSubtotal: 200, poDiscountAmount: 20, cumulativeOrderedValue: 200,
      previousSubtotal: 100, previousDiscount: 10, previousPpn: 10, finalReceipt: true,
    })).toMatchObject({ discountAmount: 10, taxableAmount: 140, ppnAmount: 15, total: 155 });
  });

  it('defers a capped partial discount and refuses an impossible final discount', () => {
    const context = { poSubtotal: 200, poDiscountAmount: 100, cumulativeOrderedValue: 100,
      previousSubtotal: 0, previousDiscount: 0, previousPpn: 0, finalReceipt: false };
    expect(receiptProcurementAmounts([{ quantity: 1, unitCost: 5 }], 11, context))
      .toMatchObject({ discountAmount: 5, taxableAmount: 0, total: 0 });
    expect(() => receiptProcurementAmounts([{ quantity: 1, unitCost: 5 }], 11, { ...context, finalReceipt: true }))
      .toThrow(/Sisa diskon PO/);
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
