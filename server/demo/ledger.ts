/**
 * Builds the Thalia demo dataset as a flat list of parameterised statements.
 *
 * Everything is derived from `./catalog` plus a seeded PRNG, so two runs on the
 * same day produce the same totals. Dates are anchored to the run date so the
 * dashboard always has activity in the current month and week.
 *
 * Statement order mirrors how a shop's data actually arrives: profile → shelves
 * → staff → stock batches → till sessions → sales → purchasing → replenishment
 * orders → costs → attendance → audit trail.
 */
import { randomUUID } from 'node:crypto';
import { THALIA, THALIA_NOTES, type DemoProduct } from './catalog.js';

export interface DemoStatement {
  sql: string;
  args: (string | number | null)[];
}

export interface ThaliaBranchRow {
  id: string;
  name: string;
  code: string;
  type: 'store' | 'online' | 'hybrid';
  address: string;
  phone: string;
  target: number;
  /** Cashier who owns the till sessions at this branch. */
  cashierId: string;
}

export interface ThaliaStaffRow {
  id: string;
  name: string;
  email: string;
  role: string;
  branchId: string | null;
  salary: number;
}

export interface ThaliaSupplierRow {
  id: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  category: string;
  legalName: string;
  city: string;
  province: string;
  postalCode: string;
  taxId: string;
  website: string;
  termsDays: number;
  leadTimeDays: number;
  rating: number;
  creditLimit: number;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  notes: string;
}

export interface ThaliaCustomerRow {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

export interface ThaliaUnitRow {
  id: string;
  name: string;
  factor: number;
  price: number;
  barcode: string;
}

export interface ThaliaProductRow {
  id: string;
  def: DemoProduct;
  /** `units[0]` is always the base unit (factor 1). */
  units: ThaliaUnitRow[];
}

export interface ThaliaIdentity {
  tenantId: string;
  ownerId: string;
  owner: { name: string; email: string };
  branches: ThaliaBranchRow[];
  /** Company-wide gudang; every branch order is picked from here. */
  centralWarehouseId: string;
  /**
   * The shop's own selling shelf, one entry per branch index (`null` for the
   * online channel, which has no shelf and is served from the gudang).
   */
  shelfWarehouseIds: (string | null)[];
  staff: ThaliaStaffRow[];
  suppliers: ThaliaSupplierRow[];
  customers: ThaliaCustomerRow[];
  categories: { id: string; name: string }[];
  products: ThaliaProductRow[];
}

/** Deterministic PRNG (mulberry32): same seed, same shop. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const EAN_PREFIX = '899';

/** Stable 13-digit barcode per selling unit. */
function makeBarcode(sequence: number): string {
  return `${EAN_PREFIX}${String(1_000_000 + sequence * 37).padStart(10, '0')}`;
}

/**
 * Assigns ids to the whole catalog. Pass `tenantId`/`ownerId` when seeding into
 * a database that already has a tenant row (e.g. one created through
 * `/register-tenant`), so the demo attaches instead of duplicating.
 */
export function createThaliaIdentity(
  overrides: { tenantId?: string; ownerId?: string } = {}
): ThaliaIdentity {
  let barcodeSeq = 0;

  const staff: ThaliaStaffRow[] = THALIA.staff.map((member) => ({
    id: randomUUID(),
    name: member.name,
    email: member.email,
    role: member.role,
    branchId: null,
    salary: member.salary,
  }));

  const centralWarehouseId = randomUUID();
  // A walk-in shop sells off its own shelf; the online channel keeps none.
  const shelfWarehouseIds: (string | null)[] = THALIA.branches.map((branch) =>
    branch.shelf ? randomUUID() : null
  );

  const branches: ThaliaBranchRow[] = THALIA.branches.map((branch, index) => {
    // The till at each branch belongs to its own cashier.
    const cashier = staff.find(
      (_, staffIndex) => THALIA.staff[staffIndex].role === 'cashier' && THALIA.staff[staffIndex].branch === index
    );
    return {
      id: randomUUID(),
      name: branch.name,
      code: branch.code,
      type: branch.type,
      address: branch.address,
      phone: branch.phone,
      target: branch.target,
      cashierId: cashier?.id ?? staff[0].id,
    };
  });

  staff.forEach((member, index) => {
    const branch = THALIA.staff[index].branch;
    member.branchId = branch === null ? null : branches[branch].id;
  });

  return {
    tenantId: overrides.tenantId ?? randomUUID(),
    ownerId: overrides.ownerId ?? randomUUID(),
    owner: { ...THALIA.owner },
    branches,
    centralWarehouseId,
    shelfWarehouseIds,
    staff,
    suppliers: THALIA.suppliers.map((supplier) => ({ id: randomUUID(), ...supplier })),
    customers: THALIA.customers.map((customer) => ({ id: randomUUID(), ...customer })),
    categories: THALIA.categories.map((name) => ({ id: randomUUID(), name })),
    products: THALIA.products.map((def) => ({
      id: randomUUID(),
      def,
      units: def.units.map((unit) => ({
        id: randomUUID(),
        name: unit.name,
        factor: unit.factor,
        price: unit.price,
        barcode: makeBarcode(++barcodeSeq),
      })),
    })),
  };
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Quantity steps that look like a real bakery order, per base unit. */
const QUANTITY_STEPS: Record<string, number[]> = {
  kg: [0.5, 1, 1.5, 2, 2.5, 3, 5],
  liter: [1, 2, 5, 10],
  pcs: [1, 2, 3, 4, 6],
  kaleng: [2, 4, 6, 12],
  pack: [1, 2, 3],
};

interface ShiftDraft {
  id: string;
  branch: ThaliaBranchRow;
  cashierId: string;
  start: Date;
  /** `null` while the session is still open. */
  end: Date | null;
  initialCash: number;
  cashSales: number;
  finalCash: number;
}

export function buildDemoStatements(identity: ThaliaIdentity, now = new Date()): DemoStatement[] {
  const statements: DemoStatement[] = [];
  const add = (sql: string, args: DemoStatement['args'] = []) => statements.push({ sql, args });

  const rand = mulberry32(0x7a11a);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
  const chance = (probability: number) => rand() < probability;

  const startOfDay = (daysAgo: number) =>
    new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - daysAgo * DAY_MS
    );
  const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);
  const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
  const stamp = (date: Date) => date.toISOString();

  const productBySku = new Map(identity.products.map((product) => [product.def.sku, product]));

  // ---------------------------------------------------------------------
  // Company profile (the seed already wrote the defaults; this personalises
  // the receipt and bank details without losing role_permissions).
  // ---------------------------------------------------------------------
  add(`UPDATE tenants SET name = ?, slug = ?, settings = json_patch(settings, ?) WHERE id = ?`, [
    THALIA.name,
    THALIA.slug,
    JSON.stringify({
      receipt: { footer: 'Terima kasih, selamat memanggang!', show_logo: true },
      bank: { name: 'BCA', account_number: '437 0012 889', account_holder: identity.owner.name },
      payroll_config: { overtime_rate: 1.5, work_hours_per_day: 8, work_days_per_month: 22 },
    }),
    identity.tenantId,
  ]);

  // The starter warehouse from `renderSeed` is a single-branch store room.
  // Thalia keeps one central gudang instead, so the demo replaces that row and
  // every mapping rather than ending up with a phantom second location.
  add(`DELETE FROM branch_warehouses`);
  add(`DELETE FROM warehouses`);

  // The one gudang, behind Toko Pusat on Jl. Arif Rahman Hakim. Written before
  // the branches because every order and every web shipment starts here.
  add(
    `INSERT OR REPLACE INTO warehouses
       (id, name, code, type, branch_id, address, status, is_default)
     VALUES (?, ?, 'GD-PST', 'central', NULL, ?, 'active', 1)`,
    [identity.centralWarehouseId, THALIA.centralWarehouse.name, THALIA.centralWarehouse.address]
  );

  identity.branches.forEach((branch, branchIndex) => {
    add(
      `INSERT OR REPLACE INTO branches
         (id, name, code, address, phone, email, timezone, status, sales_target, type, is_headquarters)
       VALUES (?, ?, ?, ?, ?, ?, 'Asia/Jakarta', 'active', ?, ?, ?)`,
      [
        branch.id,
        branch.name,
        branch.code,
        branch.address,
        branch.phone,
        `toko.${branch.code.toLowerCase()}@tokobahankue.com`,
        branch.target,
        // The central store doubles as the head office.
        branch.type,
        branchIndex === 0 ? 1 : 0,
      ]
    );

    const shelfId = identity.shelfWarehouseIds[branchIndex];
    const shelf = THALIA.branches[branchIndex].shelf;

    if (!shelfId || !shelf) {
      // Online: no shelf, so the gudang is the only place its orders come from.
      add(
        `INSERT OR REPLACE INTO branch_warehouses (branch_id, warehouse_id, is_default, priority)
         VALUES (?, ?, 1, 1)`,
        [branch.id, identity.centralWarehouseId]
      );
      return;
    }

    // A walk-in shop sells from its own rak; the gudang stays mapped behind it
    // as the fallback stockroom (priority 2), which is also where orders are
    // picked from.
    add(
      `INSERT OR REPLACE INTO warehouses
         (id, name, code, type, branch_id, address, status, is_default)
       VALUES (?, ?, ?, 'store', ?, ?, 'active', 0)`,
      [shelfId, shelf.name, shelf.code, branch.id, branch.address]
    );
    add(
      `INSERT OR REPLACE INTO branch_warehouses (branch_id, warehouse_id, is_default, priority)
       VALUES (?, ?, 1, 1)`,
      [branch.id, shelfId]
    );
    add(
      `INSERT OR REPLACE INTO branch_warehouses (branch_id, warehouse_id, is_default, priority)
       VALUES (?, ?, 0, 2)`,
      [branch.id, identity.centralWarehouseId]
    );
  });

  // ---------------------------------------------------------------------
  // People
  // ---------------------------------------------------------------------
  add(`UPDATE users SET name = ?, email = ?, role = 'tenant_owner', is_active = 1 WHERE id = ?`, [
    identity.owner.name,
    identity.owner.email,
    identity.ownerId,
  ]);

  identity.staff.forEach((member) => {
    add(
      `INSERT OR REPLACE INTO users
         (id, email, name, role, assigned_branch_id, is_active, base_salary)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [member.id, member.email, member.name, member.role, member.branchId, member.salary]
    );
  });

  // ---------------------------------------------------------------------
  // Suppliers, customers, shelves
  // ---------------------------------------------------------------------
  identity.suppliers.forEach((supplier, index) => {
    add(
      `INSERT OR REPLACE INTO suppliers
         (id, code, name, legal_name, category, tax_id, website, contact_person, phone, email,
          address, city, province, postal_code, payment_terms_days, lead_time_days, credit_limit,
          rating, bank_name, bank_account_number, bank_account_name, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        supplier.id,
        `VND-${String(index + 1).padStart(4, '0')}`,
        supplier.name,
        supplier.legalName,
        supplier.category,
        supplier.taxId,
        supplier.website || null,
        supplier.contact,
        supplier.phone,
        supplier.email,
        supplier.address,
        supplier.city,
        supplier.province,
        supplier.postalCode,
        supplier.termsDays,
        supplier.leadTimeDays,
        supplier.creditLimit,
        supplier.rating,
        supplier.bankName,
        supplier.bankAccountNumber,
        supplier.bankAccountName,
        supplier.notes,
      ]
    );
  });

  // The seed ships generic starter categories; this shop's shelves replace them.
  add(`DELETE FROM categories`);
  identity.categories.forEach((category) => {
    add(`INSERT INTO categories (id, name) VALUES (?, ?)`, [category.id, category.name]);
  });

  identity.products.forEach((product) => {
    const supplier = identity.suppliers[product.def.supplier];
    add(
      `INSERT INTO products
         (id, sku, name, description, category, cost_price, min_stock_level, is_tracked, supplier_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        product.id,
        product.def.sku,
        product.def.name,
        THALIA_NOTES[product.def.sku] ?? null,
        product.def.category,
        product.def.cost,
        product.def.minStock,
        supplier?.id ?? null,
      ]
    );
    product.units.forEach((unit) => {
      add(
        `INSERT INTO product_units (id, product_id, name, conversion_factor, price, barcode)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [unit.id, product.id, unit.name, unit.factor, unit.price, unit.barcode]
      );
    });

    // Each product's main vendor also owns a catalogue entry, so the vendor
    // detail screen has SKU, last cost and minimum order filled in.
    if (supplier) {
      add(
        `INSERT INTO vendor_products
           (id, vendor_id, product_id, vendor_sku, last_cost, lead_time_days, min_order_qty, is_preferred)
         VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
        [
          randomUUID(),
          supplier.id,
          product.id,
          product.def.sku,
          product.def.cost,
          supplier.leadTimeDays,
        ]
      );
    }
  });

  // ---------------------------------------------------------------------
  // Stock on hand: two receipts per product per location so FIFO has a choice.
  // `quantity_current` is what is left today; the older receipt was bigger.
  // Keyed by location, because the till at each shop sells its own shelf while
  // web orders are picked at the gudang.
  // ---------------------------------------------------------------------
  const batchesByProduct = new Map<string, string[]>();
  let batchSeq = 0;
  const locationKey = (warehouseId: string, productId: string) =>
    `${warehouseId}|${productId}`;

  const addBatches = (warehouseId: string, product: ThaliaProductRow, total: number) => {
    if (total <= 0) return;
    const shelfLife = product.def.shelfLifeDays;
    const olderAge = Math.max(4, Math.min(55, Math.floor((shelfLife ?? 120) * 0.35)));
    const newerAge = Math.max(2, Math.floor(olderAge * 0.25));

    const olderQty = Math.round(total * 0.6);
    const legs = [
      { quantity: olderQty, ageDays: olderAge, cost: Math.round(product.def.cost * 0.96), multiplier: 1.3 },
      { quantity: total - olderQty, ageDays: newerAge, cost: product.def.cost, multiplier: 1.1 },
    ];
    const batchIds: string[] = [];

    legs.forEach((leg) => {
      if (leg.quantity <= 0) return;
      const batchId = randomUUID();
      const receivedAt = new Date(startOfDay(leg.ageDays).getTime() + 3 * HOUR_MS);
      batchIds.push(batchId);
      batchSeq += 1;
      add(
        `INSERT INTO product_batches
           (id, warehouse_id, product_id, batch_number, expiry_date,
            quantity_initial, quantity_current, cost_price, received_at, supplier_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          batchId,
          warehouseId,
          product.id,
          `GRN-${dateOnly(receivedAt).replace(/-/g, '')}-${String(batchSeq).padStart(3, '0')}`,
          shelfLife === null ? null : dateOnly(addDays(receivedAt, shelfLife)),
          Math.ceil(leg.quantity * leg.multiplier),
          leg.quantity,
          leg.cost,
          stamp(receivedAt),
          identity.suppliers[product.def.supplier]?.id ?? null,
        ]
      );
    });

    batchesByProduct.set(locationKey(warehouseId, product.id), batchIds);
  };

  identity.products.forEach((product) => {
    addBatches(identity.centralWarehouseId, product, product.def.stock.central);
    identity.shelfWarehouseIds.forEach((shelfId, branchIndex) => {
      if (!shelfId) return;
      // `shelves` is authored in branch order, so the index lines up.
      addBatches(shelfId, product, product.def.stock.shelves[branchIndex] ?? 0);
    });
  });

  // ---------------------------------------------------------------------
  // Till sessions and the sales that ran through them
  // ---------------------------------------------------------------------
  const shifts: ShiftDraft[] = [];
  const customerTotals = new Map<string, number>();
  const auditedSales: { id: string; invoice: string; total: number; branchId: string; cashierId: string; method: string }[] = [];

  const writeSale = (options: {
    branchIndex: number;
    shiftId: string | null;
    cashierId: string;
    createdAt: Date;
    invoice: string;
    lines: { product: ThaliaProductRow; unit: ThaliaUnitRow; quantity: number }[];
    method: string;
    customerId: string | null;
    amountPaidOverride?: number;
    dueDate?: string | null;
    notes?: string | null;
  }) => {
    const transactionId = randomUUID();
    // A walk-in shop sells from its own shelf; the online channel has none, so
    // its orders are picked at the gudang.
    const sellingLocationId =
      identity.shelfWarehouseIds[options.branchIndex] ?? identity.centralWarehouseId;
    const items = options.lines.map((line) => {
      const batchIds = batchesByProduct.get(locationKey(sellingLocationId, line.product.id));
      return {
        id: randomUUID(),
        productId: line.product.id,
        batchId: batchIds?.[0] ?? null,
        quantity: line.quantity,
        unitName: line.unit.name,
        factor: line.unit.factor,
        unitPrice: line.unit.price,
        costPrice: Math.round(line.product.def.cost * line.unit.factor),
        subtotal: Math.round(line.unit.price * line.quantity),
      };
    });
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    const amountPaid = options.amountPaidOverride ?? total;

    add(
      `INSERT INTO transactions
         (id, branch_id, cashier_id, customer_id, shift_id, invoice_number,
          total_amount, amount_paid, due_date, payment_method, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`,
      [
        transactionId,
        identity.branches[options.branchIndex].id,
        options.cashierId,
        options.customerId,
        options.shiftId,
        options.invoice,
        total,
        amountPaid,
        options.dueDate ?? null,
        options.method,
        options.notes ?? null,
        stamp(options.createdAt),
      ]
    );

    items.forEach((item) => {
      add(
        `INSERT INTO transaction_items
           (id, transaction_id, product_id, batch_id, quantity, unit_name,
            conversion_factor, unit_price, cost_price, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          transactionId,
          item.productId,
          item.batchId,
          item.quantity,
          item.unitName,
          item.factor,
          item.unitPrice,
          item.costPrice,
          item.subtotal,
        ]
      );
    });

    if (options.customerId) {
      customerTotals.set(options.customerId, (customerTotals.get(options.customerId) ?? 0) + total);
    }
    auditedSales.push({
      id: transactionId,
      invoice: options.invoice,
      total,
      branchId: identity.branches[options.branchIndex].id,
      cashierId: options.cashierId,
      method: options.method,
    });
    return total;
  };

  /** A believable bakery basket: 1â€“4 lines, mostly base units, now and then a sack. */
  const buildBasket = () => {
    const lines: { product: ThaliaProductRow; unit: ThaliaUnitRow; quantity: number }[] = [];
    const wanted = int(1, 4);
    const used = new Set<string>();
    let guard = 0;
    while (lines.length < wanted && guard < 20) {
      guard += 1;
      const product = pick(identity.products);
      if (used.has(product.id)) continue;
      used.add(product.id);
      const bulk = product.units.length > 1 && product.units[1].factor >= 5 && chance(0.18);
      const unit = bulk ? product.units[1] : product.units[0];
      const quantity = bulk ? 1 : pick(QUANTITY_STEPS[unit.name] ?? [1, 2, 3]);
      lines.push({ product, unit, quantity });
    }
    return lines;
  };

  // One running sequence keeps invoice numbers unique even when a session runs
  // past midnight.
  let invoiceSeq = 0;
  const nextInvoice = (date: Date, code: string) =>
    `INV/${dateOnly(date).replace(/-/g, '')}-${code}-${String((invoiceSeq += 1)).padStart(4, '0')}`;

  // 21 days of trading, both branches. Today's session is left open and
  // anchored a few hours back, so the till is usable the moment the demo opens
  // and nothing is booked into the future.
  for (let daysAgo = 20; daysAgo >= 0; daysAgo -= 1) {
    const isToday = daysAgo === 0;
    identity.branches.forEach((branch, branchIndex) => {
      const start = isToday
        ? new Date(now.getTime() - 3 * HOUR_MS)
        : new Date(startOfDay(daysAgo).getTime() + 1 * HOUR_MS); // 08:00 WIB
      const end = isToday ? null : new Date(start.getTime() + 9 * HOUR_MS); // 17:00 WIB
      const shift: ShiftDraft = {
        id: randomUUID(),
        branch,
        cashierId: branch.cashierId,
        start,
        end,
        initialCash: 500_000,
        cashSales: 0,
        finalCash: 0,
      };
      shifts.push(shift);

      const weekday = start.getUTCDay();
      const busy = weekday === 0 || weekday === 6;
      const salesToday = busy ? int(4, 7) : int(2, 5);
      const windowMs = Math.max((end ?? now).getTime() - start.getTime() - 60_000, 60_000);

      for (let index = 0; index < salesToday; index += 1) {
        const createdAt = new Date(start.getTime() + Math.floor(rand() * windowMs));
        const roll = rand();
        const method = roll < 0.55 ? 'cash' : roll < 0.75 ? 'card' : 'ewallet';
        const lines = buildBasket();
        const total = lines.reduce((sum, line) => sum + Math.round(line.unit.price * line.quantity), 0);
        const amountPaid = method === 'cash' ? Math.ceil(total / 5_000) * 5_000 : total;
        const customer = chance(0.45) ? pick(identity.customers) : null;

        const spent = writeSale({
          branchIndex,
          shiftId: shift.id,
          cashierId: branch.cashierId,
          createdAt,
          invoice: nextInvoice(createdAt, branch.code),
          lines,
          method,
          customerId: customer?.id ?? null,
          amountPaidOverride: amountPaid,
          notes: chance(0.1) ? 'Minta nota rangkap' : null,
        });

        if (method === 'cash') shift.cashSales += spent;
      }

      if (isToday) return;
      const variance = pick([0, 0, 0, 0, -5_000, 5_000, -12_000, 3_000]);
      shift.finalCash = shift.initialCash + shift.cashSales + variance;
    });
  }

  shifts.forEach((shift) => {
    const open = shift.end === null;
    const expected = shift.initialCash + shift.cashSales;
    const difference = shift.finalCash - expected;
    add(
      `INSERT INTO shifts
         (id, branch_id, user_id, start_time, end_time, initial_cash,
          final_cash, expected_cash, difference, notes, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shift.id,
        shift.branch.id,
        shift.cashierId,
        stamp(shift.start),
        open ? null : stamp(shift.end as Date),
        shift.initialCash,
        open ? null : shift.finalCash,
        open ? null : expected,
        open ? null : difference,
        open
          ? 'Shift berjalan'
          : difference === 0
            ? 'Kas sesuai'
            : 'Selisih kas dilaporkan ke kepala toko',
        open ? 'open' : 'closed',
      ]
    );
  });

  // Older history without a till session, so monthly and 90-day reports have
  // something to compare the current month against.
  for (let daysAgo = 40; daysAgo > 20; daysAgo -= 1) {
    identity.branches.forEach((branch, branchIndex) => {
      const createdAt = new Date(startOfDay(daysAgo).getTime() + int(2, 9) * HOUR_MS);
      writeSale({
        branchIndex,
        shiftId: null,
        cashierId: branch.cashierId,
        createdAt,
        invoice: nextInvoice(createdAt, branch.code),
        lines: buildBasket(),
        method: chance(0.6) ? 'cash' : 'card',
        customerId: chance(0.4) ? pick(identity.customers).id : null,
      });
    });
  }

  // Consignment sales to bakeries: delivered now, paid on 14-day terms. These
  // are what the Piutang (AR) tab shows.
  for (let index = 0; index < 5; index += 1) {
    const daysAgo = int(3, 28);
    const branchIndex = int(0, identity.branches.length - 1);
    const createdAt = new Date(startOfDay(daysAgo).getTime() + int(2, 8) * HOUR_MS);
    const lines = buildBasket();
    const total = lines.reduce((sum, line) => sum + Math.round(line.unit.price * line.quantity), 0);
    writeSale({
      branchIndex,
      shiftId: null,
      cashierId: identity.branches[branchIndex].cashierId,
      createdAt,
      invoice: nextInvoice(createdAt, identity.branches[branchIndex].code),
      lines,
      method: 'credit',
      customerId: pick(identity.customers.filter((customer) => customer.name !== 'Warung Kue Neng Iis')).id,
      amountPaidOverride: chance(0.4) ? Math.round(total * 0.4) : 0,
      dueDate: dateOnly(addDays(createdAt, 14)),
      notes: 'Tempo 14 hari',
    });
  }

  // ---------------------------------------------------------------------
  // Customers, now that their lifetime spend is known
  // ---------------------------------------------------------------------
  identity.customers.forEach((customer) => {
    const spent = customerTotals.get(customer.id) ?? 0;
    add(
      `INSERT OR REPLACE INTO customers
         (id, name, phone, email, address, notes, total_spent, points)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        customer.id,
        customer.name,
        customer.phone,
        customer.email,
        customer.address,
        customer.notes,
        spent,
        Math.floor(spent / 10_000),
      ]
    );
  });

  // ---------------------------------------------------------------------
  // Purchasing: one order in every reachable state, plus the deliveries that
  // moved money. Shelf stock was authored above, so a receipt here writes the
  // document, the received quantities and the bill — it does not add a second
  // copy of the stock, which would double every on-hand figure.
  //
  // `quantity_received` is what the PO list, the detail sheet and the receipt
  // dialog read, so it is derived from the deliveries written beside it.
  // ---------------------------------------------------------------------
  interface PurchaseDelivery {
    /** Days after the order was raised. */
    daysAfter: number;
    lines: { sku: string; quantity: number }[];
    /** The vendor's own delivery-note number. */
    document?: string;
  }
  interface PurchaseDraft {
    supplier: number;
    branchIndex: number;
    status:
      | 'draft'
      | 'submitted'
      | 'approved'
      | 'partially_received'
      | 'received'
      | 'rejected'
      | 'cancelled';
    daysAgo: number;
    expectedInDays?: number;
    notes: string;
    /** Shown on the detail sheet for a rejected or cancelled order. */
    reason?: string;
    lines: { sku: string; quantity: number }[];
    deliveries?: PurchaseDelivery[];
    /** Settle half of the first bill, so the vendor statement has a payment. */
    partiallyPaid?: boolean;
  }

  const purchasePlan: PurchaseDraft[] = [
    {
      supplier: 1,
      branchIndex: 0,
      status: 'received',
      daysAgo: 12,
      notes: 'Restock tepung bulanan',
      lines: [
        { sku: 'TPG-001', quantity: 250 },
        { sku: 'TPG-002', quantity: 300 },
      ],
      deliveries: [
        {
          daysAfter: 2,
          lines: [
            { sku: 'TPG-001', quantity: 250 },
            { sku: 'TPG-002', quantity: 300 },
          ],
        },
      ],
    },
    {
      supplier: 0,
      branchIndex: 0,
      status: 'received',
      daysAgo: 20,
      notes: 'Cokelat dan pengembang',
      lines: [
        { sku: 'CHC-001', quantity: 40 },
        { sku: 'CHC-003', quantity: 24 },
        { sku: 'PGR-001', quantity: 120 },
      ],
      deliveries: [
        {
          daysAfter: 3,
          lines: [
            { sku: 'CHC-001', quantity: 40 },
            { sku: 'CHC-003', quantity: 24 },
            { sku: 'PGR-001', quantity: 120 },
          ],
        },
      ],
      partiallyPaid: true,
    },
    {
      // The interesting one: half the order arrived, so the list has to say
      // "Diterima Sebagian" and the receipt dialog still offers the rest.
      supplier: 3,
      branchIndex: 0,
      status: 'partially_received',
      daysAgo: 6,
      notes: 'Susu dan whipping cream, dikirim dua tahap',
      lines: [
        { sku: 'TLR-004', quantity: 36 },
        { sku: 'TLR-002', quantity: 24 },
      ],
      deliveries: [
        {
          daysAfter: 2,
          document: 'SJ-DPR-8841',
          lines: [
            { sku: 'TLR-004', quantity: 20 },
            { sku: 'TLR-002', quantity: 24 },
          ],
        },
      ],
    },
    {
      supplier: 3,
      branchIndex: 0,
      status: 'approved',
      daysAgo: 2,
      expectedInDays: 4,
      notes: 'Susu kental manis untuk produksi bulan depan',
      lines: [{ sku: 'TLR-003', quantity: 30 }],
    },
    {
      supplier: 4,
      branchIndex: 1,
      status: 'submitted',
      daysAgo: 1,
      expectedInDays: 3,
      notes: 'Kemasan box dan kertas roti',
      lines: [
        { sku: 'KMS-004', quantity: 400 },
        { sku: 'KMS-002', quantity: 12 },
      ],
    },
    {
      supplier: 4,
      branchIndex: 1,
      status: 'draft',
      daysAgo: 0,
      notes: 'Box kue untuk pesanan akhir bulan',
      lines: [{ sku: 'KMS-004', quantity: 500 }],
    },
    {
      supplier: 1,
      branchIndex: 0,
      status: 'rejected',
      daysAgo: 9,
      notes: 'Gula pasir curah 50 kg',
      reason: 'Harga di atas penawaran vendor lain',
      lines: [{ sku: 'GLA-001', quantity: 40 }],
    },
  ];

  const documentCounters = new Map<string, number>();
  const nextDocumentNumber = (prefix: 'PO' | 'GRN', date: Date) => {
    const head = `${prefix}-${dateOnly(date).replace(/-/g, '')}`;
    const sequence = (documentCounters.get(head) ?? 0) + 1;
    documentCounters.set(head, sequence);
    return `${head}-${String(sequence).padStart(4, '0')}`;
  };

  /** Kept for the audit trail written further down. */
  const purchaseAudit: {
    id: string;
    poNumber: string;
    status: string;
    itemCount: number;
    daysAgo: number;
  }[] = [];

  purchasePlan.forEach((order) => {
    const purchaseOrderId = randomUUID();
    const createdAt = new Date(startOfDay(order.daysAgo).getTime() + 4 * HOUR_MS);
    const supplier = identity.suppliers[order.supplier];
    const branch = identity.branches[order.branchIndex];
    const poNumber = nextDocumentNumber('PO', createdAt);

    const items = order.lines.flatMap((line) => {
      const product = productBySku.get(line.sku);
      return product ? [{ product, quantity: line.quantity }] : [];
    });

    purchaseAudit.push({
      id: purchaseOrderId,
      poNumber,
      status: order.status,
      itemCount: items.length,
      daysAgo: order.daysAgo,
    });

    const receivedBySku = new Map<string, number>();
    order.deliveries?.forEach((delivery) =>
      delivery.lines.forEach((line) =>
        receivedBySku.set(line.sku, (receivedBySku.get(line.sku) ?? 0) + line.quantity)
      )
    );

    const total = items.reduce((sum, item) => sum + item.product.def.cost * item.quantity, 0);
    const submittedAt = order.status === 'draft' ? null : new Date(createdAt.getTime() + 2 * HOUR_MS);
    const approvedAt =
      order.status === 'approved' ||
      order.status === 'partially_received' ||
      order.status === 'received'
        ? new Date(createdAt.getTime() + 5 * HOUR_MS)
        : null;
    const rejectedAt = order.status === 'rejected' ? new Date(createdAt.getTime() + 5 * HOUR_MS) : null;
    const cancelledAt = order.status === 'cancelled' ? new Date(createdAt.getTime() + 5 * HOUR_MS) : null;
    const firstDelivery = order.deliveries?.[0];
    const firstReceivedAt = firstDelivery
      ? new Date(createdAt.getTime() + firstDelivery.daysAfter * DAY_MS + 6 * HOUR_MS)
      : null;

    add(
      `INSERT INTO purchase_orders
         (id, po_number, supplier_id, supplier_name, branch_id, warehouse_id, status, total_amount,
          notes, expected_date, payment_terms_days, submitted_by, submitted_at, approved_by,
          approved_at, rejected_by, rejected_at, rejection_reason, cancelled_by, cancelled_at,
          cancel_reason, received_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        purchaseOrderId,
        poNumber,
        supplier.id,
        supplier.name,
        branch.id,
        identity.centralWarehouseId,
        order.status,
        total,
        order.notes,
        order.expectedInDays !== undefined
          ? dateOnly(addDays(createdAt, order.expectedInDays))
          : dateOnly(firstReceivedAt ?? createdAt),
        supplier.termsDays,
        submittedAt ? identity.staff[0].id : null,
        submittedAt ? stamp(submittedAt) : null,
        approvedAt ? identity.ownerId : null,
        approvedAt ? stamp(approvedAt) : null,
        rejectedAt ? identity.ownerId : null,
        rejectedAt ? stamp(rejectedAt) : null,
        rejectedAt ? order.reason ?? null : null,
        cancelledAt ? identity.ownerId : null,
        cancelledAt ? stamp(cancelledAt) : null,
        cancelledAt ? order.reason ?? null : null,
        firstReceivedAt ? stamp(firstReceivedAt) : null,
        identity.staff[0].id,
        stamp(createdAt),
        stamp(createdAt),
      ]
    );

    const itemIds = new Map<string, string>();
    items.forEach((item) => {
      const itemId = randomUUID();
      itemIds.set(item.product.def.sku, itemId);
      add(
        `INSERT INTO purchase_order_items
           (id, purchase_order_id, product_id, quantity, quantity_received, unit_name,
            conversion_factor, unit_cost, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          itemId,
          purchaseOrderId,
          item.product.id,
          item.quantity,
          receivedBySku.get(item.product.def.sku) ?? 0,
          item.product.units[0].name,
          item.product.def.cost,
          item.product.def.cost * item.quantity,
        ]
      );
    });

    // One document, one bill per delivery — the same split the receipt writer
    // makes, so the vendor screen and the finance screen cannot disagree.
    order.deliveries?.forEach((delivery, index) => {
      const receiptId = randomUUID();
      const receivedAt = new Date(createdAt.getTime() + delivery.daysAfter * DAY_MS + 6 * HOUR_MS);
      const grnNumber = nextDocumentNumber('GRN', receivedAt);
      const lines = delivery.lines.flatMap((line) => {
        const product = productBySku.get(line.sku);
        const itemId = itemIds.get(line.sku);
        return product && itemId ? [{ product, itemId, quantity: line.quantity }] : [];
      });
      const amount = lines.reduce((sum, line) => sum + line.product.def.cost * line.quantity, 0);

      add(
        `INSERT INTO goods_receipts
           (id, grn_number, purchase_order_id, warehouse_id, branch_id, supplier_id,
            supplier_name, supplier_document, total_amount, notes, received_by, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          receiptId,
          grnNumber,
          purchaseOrderId,
          identity.centralWarehouseId,
          branch.id,
          supplier.id,
          supplier.name,
          delivery.document ?? null,
          amount,
          index === 0 ? order.notes : null,
          identity.staff[0].id,
          stamp(receivedAt),
        ]
      );

      lines.forEach((line) => {
        add(
          `INSERT INTO goods_receipt_items
             (id, goods_receipt_id, purchase_order_item_id, product_id, quantity, unit_name,
              conversion_factor, unit_cost, subtotal, batch_number, expiry_date)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          [
            randomUUID(),
            receiptId,
            line.itemId,
            line.product.id,
            line.quantity,
            line.product.units[0].name,
            line.product.def.cost,
            line.product.def.cost * line.quantity,
            grnNumber,
            line.product.def.shelfLifeDays === null
              ? null
              : dateOnly(addDays(receivedAt, line.product.def.shelfLifeDays)),
          ]
        );
      });

      // A delivery is when the liability starts, so the bill is dated by the
      // receipt and falls due on the terms snapshotted onto the order.
      const expenseId = randomUUID();
      const settleHalf = order.partiallyPaid === true && index === 0;
      const paid = settleHalf ? Math.round(amount * 0.5) : 0;
      add(
        `INSERT INTO expenses
           (id, branch_id, category, amount, date, due_date, description, status,
            amount_paid, supplier_id, purchase_order_id, goods_receipt_id, notes, created_at)
         VALUES (?, ?, 'Pembelian Stok', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          expenseId,
          branch.id,
          amount,
          dateOnly(receivedAt),
          dateOnly(addDays(receivedAt, supplier.termsDays)),
          `Pembelian stok ${grnNumber} (PO ${poNumber}) - ${supplier.name}`,
          paid >= amount ? 'paid' : 'unpaid',
          paid,
          supplier.id,
          purchaseOrderId,
          receiptId,
          order.notes,
          stamp(receivedAt),
        ]
      );

      // The settled bill also leaves a trace in the vendor payment ledger, so
      // the vendor screen shows a real payment history instead of an empty tab.
      if (settleHalf && paid > 0) {
        add(
          `INSERT INTO vendor_payments
             (id, vendor_id, expense_id, purchase_order_id, amount, payment_date,
              method, reference_number, created_by, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'transfer', ?, ?, ?)`,
          [
            randomUUID(),
            supplier.id,
            expenseId,
            purchaseOrderId,
            paid,
            dateOnly(addDays(receivedAt, 2)),
            `TRF-${grnNumber}`,
            identity.staff[0].id,
            stamp(addDays(receivedAt, 2)),
          ]
        );
      }
    });
  });

  // ---------------------------------------------------------------------
  // Branch replenishment orders: the demand document a shop raises
  // (`stock_requests`) and the movement document the gudang issues against it
  // (`stock_transfers`, linked by `request_id`). Seeded through the same SQL
  // shapes the BranchOrders screen writes, so every screen reads them alike.
  //
  // The gudang batch figures in the catalog are already "what is left today",
  // so the shipments below do not deduct anything a second time.
  // ---------------------------------------------------------------------
  const requestAudit: {
    action: string;
    entityId: string;
    details: Record<string, unknown>;
    userId: string;
    daysAgo: number;
  }[] = [];

  interface RequestLine {
    sku: string;
    requested: number;
    /** 0 while the gudang has not answered the request yet. */
    approved: number;
    dispatched: number;
    received: number;
  }

  interface RequestPlan {
    branchIndex: number;
    status: 'draft' | 'submitted' | 'in_transit' | 'received';
    daysAgo: number;
    priority: 'normal' | 'urgent';
    /** Days from creation; the shop writes what it needs by when. */
    neededInDays: number;
    notes: string | null;
    source: 'branch' | 'online';
    /** `null` when the channel has no shelf, so the goods leave the building. */
    transfer: 'in_transit' | 'completed' | null;
    items: RequestLine[];
  }

  const requestPlan: RequestPlan[] = [
    {
      // A draft the shop is still filling in.
      branchIndex: 1,
      status: 'draft',
      daysAgo: 1,
      priority: 'normal',
      neededInDays: 4,
      notes: 'Box kue dan gula halus untuk pesanan akhir pekan.',
      source: 'branch',
      transfer: null,
      items: [
        { sku: 'KMS-004', requested: 200, approved: 0, dispatched: 0, received: 0 },
        { sku: 'GLA-002', requested: 20, approved: 0, dispatched: 0, received: 0 },
        { sku: 'PGR-001', requested: 30, approved: 0, dispatched: 0, received: 0 },
      ],
    },
    {
      // Waiting in the gudang queue.
      branchIndex: 1,
      status: 'submitted',
      daysAgo: 0,
      priority: 'urgent',
      neededInDays: 1,
      notes: 'Mentega habis di rak, buttercream banyak pesanan.',
      source: 'branch',
      transfer: null,
      items: [
        { sku: 'LMK-001', requested: 12, approved: 0, dispatched: 0, received: 0 },
        { sku: 'CHC-001', requested: 10, approved: 0, dispatched: 0, received: 0 },
      ],
    },
    {
      // Picked and on the road: the gudang approved less than asked, which is
      // the normal case when stock is thin.
      branchIndex: 0,
      status: 'in_transit',
      daysAgo: 2,
      priority: 'normal',
      neededInDays: 0,
      notes: 'Restock rak Toko Pusat menjelang akhir bulan.',
      source: 'branch',
      transfer: 'in_transit',
      items: [
        { sku: 'TPG-002', requested: 60, approved: 50, dispatched: 50, received: 0 },
        { sku: 'TLR-003', requested: 24, approved: 24, dispatched: 24, received: 0 },
        { sku: 'GLA-001', requested: 40, approved: 30, dispatched: 30, received: 0 },
      ],
    },
    {
      // Closed: the web channel ordered, the gudang shipped straight out (no
      // shelf to receive into) and the shop confirmed the goods arrived.
      branchIndex: 2,
      status: 'received',
      daysAgo: 5,
      priority: 'normal',
      neededInDays: -3,
      notes: 'Pesanan tokobahankue.com, dikirim langsung dari gudang.',
      source: 'online',
      transfer: null,
      items: [
        { sku: 'KMS-002', requested: 6, approved: 6, dispatched: 6, received: 6 },
        { sku: 'TLR-002', requested: 12, approved: 10, dispatched: 10, received: 9 },
      ],
    },
  ];

  const warehouseStaff = identity.staff.find((member) => member.role === 'warehouse') ?? identity.staff[0];
  let requestSeq = 0;

  requestPlan.forEach((plan) => {
    const branch = identity.branches[plan.branchIndex];
    const created = new Date(startOfDay(plan.daysAgo).getTime() + 8 * HOUR_MS);
    const approvedAt = new Date(created.getTime() + HOUR_MS);
    const dispatchedAt = new Date(created.getTime() + 3 * HOUR_MS);
    const receivedAt = new Date(created.getTime() + 2 * DAY_MS);

    const requestId = randomUUID();
    // One running sequence keeps the numbers unique even if two shops order
    // on the same day (per-day counters that restart would collide).
    requestSeq += 1;
    const requestNumber = `REQ/${dateOnly(created).replace(/-/g, '')}-${branch.code}-${String(
      requestSeq
    ).padStart(4, '0')}`;

    const requesterId =
      identity.staff.find((member) => member.role === 'store_manager' && member.branchId === branch.id)?.id ??
      branch.cashierId;
    const receiverId = branch.cashierId;

    const shelfId = identity.shelfWarehouseIds[plan.branchIndex];
    const shipped = plan.items.filter((line) => line.dispatched > 0);

    let transferId: string | null = null;
    if (plan.transfer && shelfId && shipped.length > 0) {
      transferId = randomUUID();
      const closed = plan.transfer === 'completed';
      add(
        `INSERT INTO stock_transfers
           (id, reference_number, source_warehouse_id, destination_warehouse_id, status,
            notes, requested_by, approved_by, received_by, sent_at, received_at,
            request_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          transferId,
          `TRF-${dateOnly(dispatchedAt).replace(/-/g, '')}-${branch.code}-01`,
          identity.centralWarehouseId,
          shelfId,
          plan.transfer,
          `Pesanan ${requestNumber}`,
          requesterId,
          warehouseStaff.id,
          closed ? receiverId : null,
          stamp(dispatchedAt),
          closed ? stamp(receivedAt) : null,
          requestId,
          stamp(created),
        ]
      );

      shipped.forEach((line) => {
        const product = productBySku.get(line.sku);
        if (!product) return;
        add(
          `INSERT INTO transfer_items
             (id, transfer_id, product_id, source_batch_id, quantity_sent, quantity_received,
              unit_name, conversion_factor, cost_price, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, NULL)`,
          [
            randomUUID(),
            transferId,
            product.id,
            batchesByProduct.get(locationKey(identity.centralWarehouseId, product.id))?.[0] ?? null,
            line.dispatched,
            plan.transfer === 'completed' ? line.received : null,
            product.units[0].name,
            product.def.cost,
          ]
        );
      });
    }

    const answered = plan.status !== 'draft' && plan.status !== 'submitted';
    const travelling = plan.status === 'in_transit' || plan.status === 'received';

    add(
      `INSERT INTO stock_requests
         (id, request_number, branch_id, warehouse_id, status, priority, source,
          needed_date, notes, rejection_reason, requested_by, approved_by, approved_at,
          dispatched_by, dispatched_at, received_by, received_at, transfer_id,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        requestId,
        requestNumber,
        branch.id,
        identity.centralWarehouseId,
        plan.status,
        plan.priority,
        plan.source,
        dateOnly(addDays(created, plan.neededInDays)),
        plan.notes,
        requesterId,
        answered ? warehouseStaff.id : null,
        answered ? stamp(approvedAt) : null,
        travelling ? warehouseStaff.id : null,
        travelling ? stamp(dispatchedAt) : null,
        plan.status === 'received' ? receiverId : null,
        plan.status === 'received' ? stamp(receivedAt) : null,
        transferId,
        stamp(created),
        stamp(plan.status === 'received' ? receivedAt : travelling ? dispatchedAt : created),
      ]
    );

    plan.items.forEach((line) => {
      const product = productBySku.get(line.sku);
      if (!product) return;
      add(
        `INSERT INTO stock_request_items
           (id, request_id, product_id, unit_name, conversion_factor,
            quantity_requested, quantity_approved, quantity_dispatched, quantity_received, notes)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`,
        [
          randomUUID(),
          requestId,
          product.id,
          product.units[0].name,
          line.requested,
          line.approved,
          line.dispatched,
          line.received,
        ]
      );
    });

    const lineSummary = plan.items.map((line) => ({
      sku: line.sku,
      requested: line.requested,
      approved: line.approved,
      dispatched: line.dispatched,
      received: line.received,
    }));

    requestAudit.push({
      action: plan.status === 'draft' ? 'create_stock_request' : 'submit_stock_request',
      entityId: requestId,
      details: { request_number: requestNumber, branch_id: branch.id, lines: lineSummary.length },
      userId: requesterId,
      daysAgo: plan.daysAgo,
    });

    if (answered) {
      requestAudit.push({
        action: 'approve_stock_request',
        entityId: requestId,
        details: { request_number: requestNumber, lines: lineSummary },
        userId: warehouseStaff.id,
        daysAgo: plan.daysAgo,
      });
    }

    if (travelling) {
      requestAudit.push({
        action: 'dispatch_stock_request',
        entityId: requestId,
        details: {
          request_number: requestNumber,
          transfer_id: transferId,
          shipped_lines: shipped.length,
          stock_issue_method: 'fifo',
        },
        userId: warehouseStaff.id,
        daysAgo: plan.daysAgo,
      });
    }

    if (plan.status === 'received') {
      requestAudit.push({
        action: 'receive_stock_request',
        entityId: requestId,
        details: { request_number: requestNumber, lines: lineSummary },
        userId: receiverId,
        daysAgo: plan.daysAgo,
      });
    }
  });

  // ---------------------------------------------------------------------
  // Operating costs. Rent, utilities and payroll repeat every month so the
  // cashflow and finance reports show a believable margin.
  // ---------------------------------------------------------------------
  const monthStart = (monthsBack: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));

  for (let monthsBack = 2; monthsBack >= 0; monthsBack -= 1) {
    const anchor = monthStart(monthsBack);
    const inCurrentMonth = monthsBack === 0;
    const bookDate = (day: number) => {
      const candidate = addDays(anchor, day - 1);
      return candidate.getTime() > now.getTime()
        ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
        : candidate;
    };

    THALIA.monthlyCosts.forEach((cost) => {
      const date = bookDate(5);
      add(
        `INSERT INTO expenses
           (id, branch_id, category, amount, date, due_date, description, status,
            amount_paid, supplier_id, notes, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 'paid', ?, NULL, NULL, ?)`,
        [
          randomUUID(),
          identity.branches[cost.branch].id,
          cost.category,
          cost.amount,
          dateOnly(date),
          `${cost.description} ${anchor.getUTCMonth() + 1}/${anchor.getUTCFullYear()}`,
          cost.amount,
          stamp(date),
        ]
      );
    });

    // Payroll lands on the 25th; the current month is only booked after that.
    const payrollDay = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 25));
    const payrollDue = !inCurrentMonth || now.getUTCDate() >= 25;
    if (payrollDue) {
      identity.branches.forEach((branch) => {
        const salary = identity.staff
          .filter((member) => member.branchId === branch.id)
          .reduce((sum, member) => sum + member.salary, 0);
        if (salary <= 0) return;
        add(
          `INSERT INTO expenses
             (id, branch_id, category, amount, date, due_date, description, status,
              amount_paid, supplier_id, notes, created_at)
           VALUES (?, ?, 'Gaji Karyawan', ?, ?, NULL, ?, 'paid', ?, NULL, NULL, ?)`,
          [
            randomUUID(),
            branch.id,
            salary,
            dateOnly(payrollDay),
            `Gaji karyawan ${branch.name} ${anchor.getUTCMonth() + 1}/${anchor.getUTCFullYear()}`,
            salary,
            stamp(payrollDay),
          ]
        );
      });
    }
  }

  THALIA.oneOffCosts.forEach((cost) => {
    const date = startOfDay(cost.daysAgo);
    add(
      `INSERT INTO expenses
         (id, branch_id, category, amount, date, due_date, description, status,
          amount_paid, supplier_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 'paid', ?, NULL, NULL, ?)`,
      [
        randomUUID(),
        identity.branches[cost.branch].id,
        cost.category,
        cost.amount,
        dateOnly(date),
        cost.description,
        cost.amount,
        stamp(date),
      ]
    );
  });

  // ---------------------------------------------------------------------
  // Attendance and leave requests for the payroll screen
  // ---------------------------------------------------------------------
  const attendanceStaff = identity.staff.filter((member) => member.branchId !== null);
  for (let daysAgo = 29; daysAgo >= 0; daysAgo -= 1) {
    const day = startOfDay(daysAgo);
    attendanceStaff.forEach((member) => {
      const roll = rand();
      if (roll < 0.05) return; // day off
      const status = roll < 0.1 ? 'absent' : roll < 0.17 ? 'late' : roll < 0.2 ? 'leave' : 'present';
      const checkIn = new Date(day.getTime() + 55 * 60_000 + int(-5, 25) * 60_000);
      const checkOut = new Date(day.getTime() + 9 * HOUR_MS + 50 * 60_000 + int(0, 45) * 60_000);
      add(
        `INSERT INTO attendance
           (id, employee_id, date, check_in, check_out, status, overtime, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          randomUUID(),
          member.id,
          dateOnly(day),
          status === 'absent' || status === 'leave' ? null : stamp(checkIn),
          status === 'absent' || status === 'leave' ? null : stamp(checkOut),
          status,
          status === 'present' && chance(0.12) ? int(1, 2) : 0,
          status === 'late' ? 'Terjebak macet' : status === 'leave' ? 'Cuti tahunan disetujui' : null,
          stamp(day),
        ]
      );
    });
  }

  const leavePlan = [
    { staffIndex: 1, type: 'annual', from: 10, to: 12, status: 'pending', reason: 'Acara keluarga di Garut' },
    { staffIndex: 2, type: 'sick', from: -6, to: -5, status: 'approved', reason: 'Demam, surat dokter terlampir' },
    { staffIndex: 4, type: 'annual', from: -20, to: -18, status: 'approved', reason: 'Ziarah keluarga' },
  ];

  leavePlan.forEach((leave) => {
    add(
      `INSERT INTO leaves (id, employee_id, type, start_date, end_date, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        identity.staff[leave.staffIndex].id,
        leave.type,
        dateOnly(startOfDay(-leave.from)),
        dateOnly(startOfDay(-leave.to)),
        leave.reason,
        leave.status,
        stamp(startOfDay(Math.abs(leave.from) + 3)),
      ]
    );
  });

  // ---------------------------------------------------------------------
  // Audit trail: a sample of the events a shop this size generates
  // ---------------------------------------------------------------------
  const auditEntries: { action: string; entity: string; entityId: string | null; details: Record<string, unknown>; userId: string; daysAgo: number }[] = [];

  // Every request transition recorded above lands in the same trail.
  auditEntries.push(
    ...requestAudit.map((entry) => ({ ...entry, entity: 'stock_requests' }))
  );

  auditedSales.slice(0, 6).forEach((sale, index) => {
    auditEntries.push({
      action: 'checkout',
      entity: 'transactions',
      entityId: sale.id,
      details: {
        invoice_number: sale.invoice,
        branch_id: sale.branchId,
        total_amount: sale.total,
        payment_method: sale.method,
      },
      userId: sale.cashierId,
      daysAgo: index + 1,
    });
  });

  purchaseAudit.forEach((order) => {
    auditEntries.push({
      action: 'create_po',
      entity: 'purchase_orders',
      entityId: order.id,
      details: {
        po_number: order.poNumber,
        item_count: order.itemCount,
        status: order.status,
        origin: 'demo seed',
      },
      userId: identity.staff[0].id,
      daysAgo: order.daysAgo,
    });
  });

  const opnameProduct = productBySku.get('TLR-001');
  if (opnameProduct) {
    auditEntries.push({
      action: 'stock_adjustment',
      entity: 'products',
      entityId: opnameProduct.id,
      details: { source: 'opname', delta: -3, reason: 'Telur pecah saat bongkar' },
      userId: identity.staff[4].id,
      daysAgo: 8,
    });
  }

  identity.staff.slice(0, 2).forEach((member) => {
    auditEntries.push({
      action: 'create_employee',
      entity: 'users',
      entityId: member.id,
      details: { role: member.role, branch_id: member.branchId },
      userId: identity.ownerId,
      daysAgo: 18,
    });
  });

  auditEntries.forEach((entry) => {
    add(
      `INSERT INTO audit_logs (id, user_id, action, entity, entity_id, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        entry.userId,
        entry.action,
        entry.entity,
        entry.entityId,
        JSON.stringify(entry.details),
        stamp(new Date(startOfDay(entry.daysAgo).getTime() + int(1, 8) * HOUR_MS)),
      ]
    );
  });

  return statements;
}
