import { describe, expect, it } from 'vitest';
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_GROUPS, resolveRolePermissions } from './roles';

const ALL_PERMISSIONS = Object.values(PERMISSION_GROUPS).flat();

describe('resolveRolePermissions', () => {
  it('returns the shipped defaults when a role has no override', () => {
    expect(resolveRolePermissions('purchasing')).toEqual(DEFAULT_ROLE_PERMISSIONS.purchasing);
    expect(resolveRolePermissions('purchasing', null)).toEqual(DEFAULT_ROLE_PERMISSIONS.purchasing);
    expect(resolveRolePermissions('purchasing', {})).toEqual(DEFAULT_ROLE_PERMISSIONS.purchasing);
  });

  it('keeps a permission that an older saved matrix never knew about', () => {
    // The shape a tenant has after pressing Simpan on the Role screen before
    // procurement shipped: every key of the time, none of the new ones.
    const stale = {
      view_dashboard: true,
      view_inventory: true,
      add_stock: true,
      view_settings: true,
    };

    const effective = resolveRolePermissions('tenant_owner', stale);

    expect(effective.create_po).toBe(true);
    expect(effective.approve_po).toBe(true);
    expect(effective.receive_po).toBe(true);
    expect(effective.cancel_po).toBe(true);
  });

  it('lets an explicit false in the override win over the default', () => {
    const effective = resolveRolePermissions('tenant_owner', { approve_po: false });

    expect(effective.approve_po).toBe(false);
    // Everything the override is silent about is unaffected.
    expect(effective.create_po).toBe(true);
  });

  it('does not grant a permission the role never had', () => {
    const effective = resolveRolePermissions('cashier', { view_inventory: true });

    expect(effective.view_inventory).toBe(true);
    expect(effective.create_po).toBeUndefined();
    expect(effective.approve_po).toBeUndefined();
  });

  it('separates raising an order from approving it', () => {
    // §4: one person may commit money, another must agree to it.
    for (const role of ['purchasing', 'store_manager', 'warehouse'] as const) {
      const effective = resolveRolePermissions(role);
      expect(effective.create_po || effective.receive_po, role).toBe(true);
      expect(effective.approve_po, role).toBeFalsy();
    }

    for (const role of ['tenant_owner', 'tenant_admin'] as const) {
      const effective = resolveRolePermissions(role);
      expect(effective.approve_po, role).toBe(true);
    }
  });

  it('keeps variant and price control with the owner, not the operator', () => {
    // §8: the person who raises an order must not also set the agreed price,
    // and the person receiving goods must not set the shelf price.
    for (const role of ['store_manager', 'warehouse', 'purchasing', 'cashier'] as const) {
      const effective = resolveRolePermissions(role);
      for (const permission of ['manage_variants', 'manage_vendor_prices', 'manage_sell_prices']) {
        expect(effective[permission], `${role}.${permission}`).toBeFalsy();
      }
    }

    for (const role of ['tenant_owner', 'tenant_admin', 'platform_owner'] as const) {
      const effective = resolveRolePermissions(role);
      for (const permission of ['manage_variants', 'manage_vendor_prices', 'manage_sell_prices']) {
        expect(effective[permission], `${role}.${permission}`).toBe(true);
      }
    }
  });

  it('gives every role a complete matrix for the permissions it holds', () => {
    const effective = resolveRolePermissions('tenant_owner');
    for (const permission of ALL_PERMISSIONS) {
      expect(effective[permission], permission).toBe(true);
    }
  });
});
