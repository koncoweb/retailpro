/**
 * Builds the Thalia demo dataset as a flat list of parameterised statements.
 *
 * Everything is derived from `./catalog` plus a seeded PRNG, so two runs on the
 * same day produce the same totals. Dates are anchored to the run date so the
 * dashboard always has activity in the current month and week.
 *
 * Statement order mirrors how a shop's data actually arrives: profile → shelves
 * → staff → stock batches → till sessions → sales → transfers → purchasing →
 * costs → attendance → audit trail.
 */
import { randomUUID } from 'node:crypto';
import { THALIA, THALIA_NOTES, type DemoProduct } from './catalog';

export interface DemoStatement {
  sql: string;
  args: (string | number | null)[];
}

export interface ThaliaBranchRow {
  id: string;
  name: string;
  code: string;
  address: string;
  phone: string;
  target: number;
  /** Cashier who owns the till sessions at this branch. */
  cashierId: string;
  /** Stockroom the till at this branch sells from. */
  warehouseId: string;
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
  /** Company-wide warehouse mapped to every branch as a secondary source. */
  centralWarehouseId: string;
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

  const branches: ThaliaBranchRow[] = THALIA.branches.map((branch, index) => {
    // The till at each branch belongs to its own cashier.
    const cashier = staff.find(
      (_, staffIndex) => THALIA.staff[staffIndex].role === 'cashier' && THALIA.staff[staffIndex].branch === index
    );
    return {
      id: randomUUID(),
      name: branch.name,
      code: branch.code,
      address: branch.address,
      phone: branch.phone,
      target: branch.target,
      cashierId: cashier?.id ?? staff[0].id,
      warehouseId: randomUUID(),
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
    centralWarehouseId: randomUUID(),
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
  const year = now.getUTCFullYear();

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
        `toko.${branch.code.toLowerCase()}@tokobahankue.id`,
        branch.target,
        // The first store doubles as the head office; the second is online-only
        // in spirit but keeps a physical backroom, i.e. a hybrid channel.
        branchIndex === 0 ? 'hybrid' : 'store',
        branchIndex === 0 ? 1 : 0,
      ]
    );

    add(
      `INSERT OR REPLACE INTO warehouses
         (id, name, code, type, branch_id, address, status, is_default)
       VALUES (?, ?, ?, 'store', ?, ?, 'active', ?)`,
      [
        branch.warehouseId,
        `${branch.name} - Gudang`,
        `${branch.code}-GD`,
        branch.id,
        branch.address,
        branchIndex === 0 ? 1 : 0,
      ]
    );

    // The branch sells from its own backroom first, then falls back to the
    // company warehouse — the many-branches-one-warehouse shape.
    add(
      `INSERT OR REPLACE INTO branch_warehouses (branch_id, warehouse_id, is_default, priority)
       VALUES (?, ?, 1, 1)`,
      [branch.id, branch.warehouseId]
    );
    add(
      `INSERT OR REPLACE INTO branch_warehouses (branch_id, warehouse_id, is_default, priority)
       VALUES (?, ?, 0, 2)`,
      [branch.id, identity.centralWarehouseId]
    );
  });

  // Shared distribution centre: stock here is available to every branch.
  add(
    `INSERT OR REPLACE INTO warehouses
       (id, name, code, type, branch_id, address, status, is_default)
     VALUES (?, 'Gudang Pusat Cimahi', 'GD-PST', 'central', NULL, ?, 'active', 0)`,
    [identity.centralWarehouseId, THALIA.address]
  );

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
  // Stock on hand, two receipts per product per branch so FIFO has a choice.
  // `quantity_current` is what is left today; the older receipt was bigger.
  // ---------------------------------------------------------------------
  const batchesByProductBranch = new Map<string, string[]>();
  let batchSeq = 0;

  identity.products.forEach((product) => {
    const shelfLife = product.def.shelfLifeDays;
    const olderAge = Math.max(4, Math.min(55, Math.floor((shelfLife ?? 120) * 0.35)));
    const newerAge = Math.max(2, Math.floor(olderAge * 0.25));

    identity.branches.forEach((branch, branchIndex) => {
      const current = product.def.stock[branchIndex] ?? 0;
      const olderQty = Math.round(current * 0.6);
      const legs = [
        { quantity: olderQty, ageDays: olderAge, cost: Math.round(product.def.cost * 0.96), multiplier: 1.3 },
        { quantity: current - olderQty, ageDays: newerAge, cost: product.def.cost, multiplier: 1.1 },
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
            branch.warehouseId,
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

      batchesByProductBranch.set(`${product.id}|${branchIndex}`, batchIds);
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
    const items = options.lines.map((line) => {
      const batchIds = batchesByProductBranch.get(`${line.product.id}|${options.branchIndex}`);
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

  /** A believable bakery basket: 1–4 lines, mostly base units, now and then a sack. */
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
  // Inter-branch transfers: two settled, one still waiting for approval
  // ---------------------------------------------------------------------
  const transferPlan = [
    {
      reference: `TRF/${year}/0001`,
      daysAgo: 12,
      status: 'completed',
      notes: 'Restock tepung dan gula untuk Antapani',
      items: [
        { sku: 'TPG-001', quantity: 25, unit: 'kg' },
        { sku: 'GLA-001', quantity: 20, unit: 'kg' },
      ],
    },
    {
      reference: `TRF/${year}/0002`,
      daysAgo: 5,
      status: 'completed',
      notes: 'Kirim box kue pesanan Bu Rina',
      items: [{ sku: 'KMS-004', quantity: 100, unit: 'pcs' }],
    },
    {
      reference: `TRF/${year}/0003`,
      daysAgo: 1,
      status: 'pending',
      notes: 'Couverture dan vanili untuk pesanan roti Harum',
      items: [
        { sku: 'CHC-003', quantity: 4, unit: 'pcs' },
        { sku: 'PGR-003', quantity: 6, unit: 'pcs' },
      ],
    },
  ] as const;

  transferPlan.forEach((transfer) => {
    const transferId = randomUUID();
    const createdAt = new Date(startOfDay(transfer.daysAgo).getTime() + 2 * HOUR_MS);
    const settled = transfer.status === 'completed';
    add(
      `INSERT INTO stock_transfers
         (id, reference_number, source_warehouse_id, destination_warehouse_id, status, notes,
          requested_by, approved_by, received_by, sent_at, received_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        transferId,
        transfer.reference,
        identity.branches[0].warehouseId,
        identity.branches[1].warehouseId,
        transfer.status,
        transfer.notes,
        identity.staff[0].id,
        settled ? identity.ownerId : null,
        settled ? identity.staff[1].id : null,
        settled ? stamp(new Date(createdAt.getTime() + 2 * HOUR_MS)) : null,
        settled ? stamp(new Date(createdAt.getTime() + 5 * HOUR_MS)) : null,
        stamp(createdAt),
      ]
    );

    transfer.items.forEach((item) => {
      const product = productBySku.get(item.sku);
      if (!product) return;
      add(
        `INSERT INTO transfer_items
           (id, transfer_id, product_id, source_batch_id, quantity_sent,
            quantity_received, unit_name, conversion_factor, cost_price, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          randomUUID(),
          transferId,
          product.id,
          settled ? batchesByProductBranch.get(`${product.id}|0`)?.[0] ?? null : null,
          item.quantity,
          settled ? item.quantity : null,
          item.unit,
          product.def.cost,
          item.sku === 'CHC-003' ? 'Kirim utuh, jangan dilelehkan' : null,
        ]
      );
    });
  });

  // ---------------------------------------------------------------------
  // Purchasing: two receipts that created today's stock, one in transit, one
  // still a draft. Receipts book a payable into `expenses`, which is what the
  // Hutang (AP), Cashflow and Journal screens all read.
  // ---------------------------------------------------------------------
  const purchasePlan = [
    {
      number: `PO/${year}/0012`,
      supplier: 1,
      branchIndex: 0,
      status: 'received',
      daysAgo: 12,
      notes: 'Restock tepung bulanan',
      items: [
        { sku: 'TPG-001', quantity: 250 },
        { sku: 'TPG-002', quantity: 300 },
      ],
    },
    {
      number: `PO/${year}/0013`,
      supplier: 0,
      branchIndex: 0,
      status: 'received',
      daysAgo: 20,
      notes: 'Cokelat dan pengembang',
      items: [
        { sku: 'CHC-001', quantity: 40 },
        { sku: 'CHC-003', quantity: 24 },
        { sku: 'PGR-001', quantity: 120 },
      ],
    },
    {
      number: `PO/${year}/0014`,
      supplier: 3,
      branchIndex: 0,
      status: 'ordered',
      daysAgo: 2,
      expectedInDays: 4,
      notes: 'Susu dan whipping cream',
      items: [
        { sku: 'TLR-004', quantity: 36 },
        { sku: 'TLR-002', quantity: 24 },
      ],
    },
    {
      number: `PO/${year}/0015`,
      supplier: 4,
      branchIndex: 1,
      status: 'draft',
      daysAgo: 0,
      notes: 'Box kue untuk pesanan akhir bulan',
      items: [{ sku: 'KMS-004', quantity: 500 }],
    },
  ] as const;

  purchasePlan.forEach((order) => {
    const purchaseOrderId = randomUUID();
    const createdAt = new Date(startOfDay(order.daysAgo).getTime() + 4 * HOUR_MS);
    const supplier = identity.suppliers[order.supplier];
    const total = order.items.reduce((sum, item) => {
      const product = productBySku.get(item.sku);
      return sum + (product ? product.def.cost * item.quantity : 0);
    }, 0);
    const receivedAt = order.status === 'received' ? new Date(createdAt.getTime() + 6 * HOUR_MS) : null;

    add(
      `INSERT INTO purchase_orders
         (id, po_number, supplier_id, supplier_name, branch_id, warehouse_id, status, total_amount,
          notes, expected_date, received_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        purchaseOrderId,
        order.number,
        supplier.id,
        supplier.name,
        identity.branches[order.branchIndex].id,
        identity.branches[order.branchIndex].warehouseId,
        order.status,
        total,
        order.notes,
        'expectedInDays' in order
          ? dateOnly(addDays(createdAt, order.expectedInDays))
          : dateOnly(receivedAt ?? createdAt),
        receivedAt ? stamp(receivedAt) : null,
        identity.staff[0].id,
        stamp(createdAt),
      ]
    );

    order.items.forEach((item) => {
      const product = productBySku.get(item.sku);
      if (!product) return;
      add(
        `INSERT INTO purchase_order_items
           (id, purchase_order_id, product_id, quantity, unit_name, conversion_factor,
            unit_cost, subtotal)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [
          randomUUID(),
          purchaseOrderId,
          product.id,
          item.quantity,
          product.units[0].name,
          product.def.cost,
          product.def.cost * item.quantity,
        ]
      );
    });

    if (order.status !== 'received' || !receivedAt) return;

    // Receipt = stock arrives and a liability appears. Booked into `expenses`
    // because AP, Cashflow and Journal all read that table.
    const partiallyPaid = order.number.endsWith('0013');
    const paid = partiallyPaid ? Math.round(total * 0.5) : 0;
    const expenseId = randomUUID();
    add(
      `INSERT INTO expenses
         (id, branch_id, category, amount, date, due_date, description, status,
          amount_paid, supplier_id, notes, created_at)
       VALUES (?, ?, 'Pembelian Stok', ?, ?, ?, ?, 'unpaid', ?, ?, ?, ?)`,
      [
        expenseId,
        identity.branches[order.branchIndex].id,
        total,
        dateOnly(receivedAt),
        dateOnly(addDays(receivedAt, supplier.termsDays)),
        `Pembelian stok ${order.number} - ${supplier.name}`,
        paid,
        supplier.id,
        order.notes,
        stamp(receivedAt),
      ]
    );

    // The half-settled PO also leaves a trace in the vendor payment ledger, so
    // the vendor screen shows a real payment history instead of an empty tab.
    if (partiallyPaid) {
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
          `TRF-${order.number}`,
          identity.staff[0].id,
          stamp(addDays(receivedAt, 2)),
        ]
      );
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

  transferPlan.forEach((transfer) => {
    auditEntries.push({
      action: 'create_transfer',
      entity: 'stock_transfers',
      entityId: null,
      details: { reference_number: transfer.reference, item_count: transfer.items.length },
      userId: identity.staff[0].id,
      daysAgo: transfer.daysAgo,
    });
    if (transfer.status === 'completed') {
      auditEntries.push({
        action: 'approve_transfer',
        entity: 'stock_transfers',
        entityId: null,
        details: { reference_number: transfer.reference, item_count: transfer.items.length },
        userId: identity.ownerId,
        daysAgo: transfer.daysAgo - 1,
      });
    }
  });

  purchasePlan.forEach((order) => {
    auditEntries.push({
      action: 'create_po',
      entity: 'purchase_orders',
      entityId: null,
      details: { po_number: order.number, item_count: order.items.length, origin: 'demo seed' },
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
