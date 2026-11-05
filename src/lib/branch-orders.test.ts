import { describe, expect, it } from 'vitest';
import {
  actionsForStatus,
  canPerform,
  canTransition,
  formatOrderNumber,
  nextOrderNumber,
  nextStatuses,
  STOCK_REQUEST_STATUS_LABEL,
  STOCK_REQUEST_STATUSES,
  summarizeOrder,
  validateApproval,
  validateDispatch,
  validateReceipt,
} from './branch-orders';
import {
  buildGrants,
  grantForRole,
  makeChecker,
  permissionRole,
  type PermissionCheck,
} from './permission-matrix';

/**
 * A `can()` for a role of an untouched tenant.
 *
 * These tests used to call `roleHasPermission()`, which read
 * `DEFAULT_ROLE_PERMISSIONS` directly and therefore could not express what an
 * owner configured. Going through `buildGrants()` means the guard is tested
 * against the same resolver the buttons use.
 */
const asRole = (role: string | null): PermissionCheck =>
  makeChecker(grantForRole(buildGrants(null), role));

describe('branch orders: status machine', () => {
  it('walks the happy path and nothing else', () => {
    expect(canTransition('draft', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'approved')).toBe(true);
    expect(canTransition('approved', 'in_transit')).toBe(true);
    expect(canTransition('in_transit', 'received')).toBe(true);
    // A shop cannot confirm receipt of goods nobody dispatched, and a finished
    // document cannot move again.
    expect(canTransition('submitted', 'received')).toBe(false);
    expect(canTransition('received', 'cancelled')).toBe(false);
    expect(canTransition('rejected', 'approved')).toBe(false);
  });

  it('allows a cancel only before the goods leave the gudang', () => {
    expect(canTransition('draft', 'cancelled')).toBe(true);
    expect(canTransition('submitted', 'cancelled')).toBe(true);
    expect(canTransition('approved', 'cancelled')).toBe(true);
    expect(canTransition('in_transit', 'cancelled')).toBe(false);
  });

  it('offers the actions that belong to each status', () => {
    expect(actionsForStatus('draft')).toEqual(['submit', 'cancel']);
    expect(actionsForStatus('submitted')).toEqual(['approve', 'reject', 'cancel']);
    expect(actionsForStatus('approved')).toEqual(['dispatch', 'cancel']);
    expect(actionsForStatus('in_transit')).toEqual(['receive']);
    expect(actionsForStatus('received')).toEqual([]);
    expect(nextStatuses('approved').sort()).toEqual(['cancelled', 'in_transit']);
  });
});

describe('branch orders: permissions', () => {
  it('separates asking from approving and shipping', () => {
    const shop = asRole('store_manager');
    const gudang = asRole('warehouse');
    const owner = asRole('tenant_owner');
    expect(shop('request_stock')).toBe(true);
    expect(shop('approve_stock_request')).toBe(false);
    expect(shop('dispatch_stock')).toBe(false);
    expect(gudang('approve_stock_request')).toBe(true);
    expect(gudang('dispatch_stock')).toBe(true);
    expect(owner('approve_stock_request')).toBe(true);
    expect(asRole('cashier')('request_stock')).toBe(false);
  });

  it('fails closed for a role the matrix does not know', () => {
    // A custom role deleted while somebody still used it resolves to no grant.
    const orphan = asRole('cust_gone');
    expect(orphan('request_stock')).toBe(false);
    expect(asRole(null)('request_stock')).toBe(false);
    expect(canPerform(orphan, 'submitted', 'approve')).toBe(false);
  });

  it('treats the legacy admin role as tenant_admin', () => {
    expect(permissionRole('admin')).toBe('tenant_admin');
    expect(asRole('admin')('approve_stock_request')).toBe(true);
    expect(canPerform(asRole('admin'), 'submitted', 'approve')).toBe(true);
  });

  it('combines the status and the permission', () => {
    expect(canPerform(asRole('warehouse'), 'submitted', 'approve')).toBe(true);
    expect(canPerform(asRole('warehouse'), 'submitted', 'dispatch')).toBe(false);
    expect(canPerform(asRole('store_manager'), 'submitted', 'approve')).toBe(false);
    expect(canPerform(asRole('store_manager'), 'in_transit', 'receive')).toBe(true);
  });

  it('follows an override the owner saved', () => {
    // The whole point of one resolver: switch the shop's approval right on in
    // Settings and the state machine hands it over without a code change.
    const grants = buildGrants({
      role_permissions: { store_manager: { approve_stock_request: true } },
    });
    const shop = makeChecker(grants['store_manager']);
    expect(canPerform(shop, 'submitted', 'approve')).toBe(true);
    // An owner turning the warehouse's dispatch off really closes the step.
    const limited = buildGrants({
      role_permissions: { warehouse: { dispatch_stock: false } },
    });
    expect(canPerform(makeChecker(limited['warehouse']), 'approved', 'dispatch')).toBe(false);
  });
});

describe('branch orders: numbering', () => {
  const day = new Date('2026-10-28T03:00:00.000Z');

  it('reads like the invoice numbers', () => {
    expect(formatOrderNumber(day, 'THL-02', 3)).toBe('REQ/20261028-THL-02-0003');
  });

  it('continues the sequence of that branch and day only', () => {
    const existing = [
      'REQ/20261028-THL-02-0001',
      'REQ/20261028-THL-02-0007',
      'REQ/20261028-THL-01-0009',
      'REQ/20261027-THL-02-0012',
    ];
    expect(nextOrderNumber(day, 'THL-02', existing)).toBe('REQ/20261028-THL-02-0008');
    expect(nextOrderNumber(day, 'THL-01', existing)).toBe('REQ/20261028-THL-01-0010');
    expect(nextOrderNumber(day, 'THL-03', existing)).toBe('REQ/20261028-THL-03-0001');
  });
});

describe('branch orders: quantities', () => {
  it('sums the running totals and the outstanding parts', () => {
    const summary = summarizeOrder([
      { quantity_requested: 10, quantity_approved: 8, quantity_dispatched: 8, quantity_received: 0 },
      { quantity_requested: 5, quantity_approved: 5, quantity_dispatched: 2, quantity_received: 2 },
    ]);
    expect(summary).toEqual({
      lineCount: 2,
      requested: 15,
      approved: 13,
      dispatched: 10,
      received: 2,
      committed: 3,
      inTransit: 8,
    });
  });

  it('treats a missing approval as "approved as requested"', () => {
    expect(validateApproval([{ quantity_requested: 4 }])).toBeNull();
    expect(
      summarizeOrder([{ quantity_requested: 4, quantity_approved: null }]).committed
    ).toBe(0);
  });

  it('never approves more than the shop asked for', () => {
    expect(validateApproval([])).toMatch(/belum punya baris/);
    expect(validateApproval([{ quantity_requested: 4, quantity_approved: 5 }])).toMatch(
      /melebihi permintaan/
    );
    expect(validateApproval([{ quantity_requested: 4, quantity_approved: -1 }])).toMatch(
      /tidak valid/
    );
  });

  it('never receives more than was dispatched', () => {
    expect(
      validateReceipt([{ quantity_requested: 4, quantity_dispatched: 3, quantity_received: 3 }])
    ).toBeNull();
    expect(
      validateReceipt([{ quantity_requested: 4, quantity_dispatched: 3, quantity_received: 4 }])
    ).toMatch(/melebihi jumlah dikirim/);
  });

  it('only dispatches what the gudang has not already promised', () => {
    expect(
      validateDispatch([{ quantity_approved: 6, onHand: 10, committed: 4 }])
    ).toBeNull();
    expect(
      validateDispatch([{ quantity_approved: 7, onHand: 10, committed: 4 }])
    ).toMatch(/Stok gudang tidak cukup/);
  });
});

describe('branch orders: status labels cover every status', () => {
  it('has a label for each status', () => {
    for (const status of STOCK_REQUEST_STATUSES) {
      expect(STOCK_REQUEST_STATUS_LABEL[status]).toBeTruthy();
    }
    expect(STOCK_REQUEST_STATUSES).toHaveLength(7);
  });
});
