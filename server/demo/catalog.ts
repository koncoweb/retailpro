/**
 * Reference demo tenant: "Thalia Toko Bahan Kue".
 *
 * A cake-and-bakery ingredient shop in Depok with a central store, a second
 * outlet and an online-only channel, all fed from one central warehouse.
 * Everything in this file is pure data — no SQL, no I/O — so the seeding script
 * and the test suite share exactly the same catalog.
 *
 * The numbers are deliberately realistic for an Indonesian baking supplier:
 * flour and sugar sell by the kilogram (and by the 25 kg sack), butter by the
 * kilogram, packaging by the piece or the box of 50, and margins sit between
 * 15% and 35%.
 */

export interface DemoUnit {
  /** Unit the customer buys, e.g. `kg`, `karung`, `pcs`. */
  name: string;
  /** Base units contained in one of these. The base unit is always 1. */
  factor: number;
  /** Selling price per unit in IDR. */
  price: number;
}

export interface DemoStock {
  /** Base units in the central gudang; the only place orders are picked from. */
  central: number;
  /** Base units on the shop's own shelf, in `THALIA.branches` order. */
  shelves: [number, number];
}

export interface DemoProduct {
  sku: string;
  name: string;
  category: string;
  /** Index into `THALIA.suppliers`. */
  supplier: number;
  /** Purchase cost per base unit in IDR. */
  cost: number;
  /** Base units below which the shop wants a warning. */
  minStock: number;
  /**
   * Units of the base unit on hand, per location. Thalia keeps one central
   * gudang behind Toko Pusat and a "rak" (selling shelf) in each walk-in shop;
   * the online channel has none and is picked straight from the gudang. Four
   * SKUs sit below `minStock` in the gudang on purpose so the low-stock and
   * ordering screens have something to show.
   */
  stock: DemoStock;
  /** Days the batch stays usable; `null` for tools and packaging. */
  shelfLifeDays: number | null;
  units: [DemoUnit, ...DemoUnit[]];
}

export interface DemoStaff {
  name: string;
  email: string;
  role: 'tenant_admin' | 'store_manager' | 'cashier' | 'warehouse' | 'staff';
  /** Index into `THALIA.branches`; `null` means "all branches". */
  branch: number | null;
  /** Monthly gross salary in IDR, used by EmployeeReports payroll. */
  salary: number;
}

export interface DemoSupplier {
  name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  /** Vendor master details shown on the back-office vendor screens. */
  category: 'supplier' | 'distributor' | 'trader' | 'manufacturer';
  legalName: string;
  city: string;
  province: string;
  postalCode: string;
  taxId: string;
  website: string;
  /** Credit term in days, copied onto every PO payable. */
  termsDays: number;
  leadTimeDays: number;
  /** 0–5 stars, as the purchasing team scores them. */
  rating: number;
  creditLimit: number;
  bankName: string;
  bankAccountNumber: string;
  bankAccountName: string;
  notes: string;
}

export interface DemoCustomer {
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

export interface DemoBranch {
  name: string;
  code: string;
  /** `online` marks the web channel: it sells without a walk-in counter. */
  type: 'store' | 'online' | 'hybrid';
  address: string;
  phone: string;
  /** Monthly sales target in IDR (Dashboard branch performance). */
  target: number;
  /**
   * The shop's own selling shelf ("rak toko"), authored rather than derived:
   * a walk-in branch sells from it, the online channel has none and is picked
   * straight out of the central gudang.
   */
  shelf: { name: string; code: string } | null;
}

/** Wraps a product row so the table below stays readable. */
function product(
  sku: string,
  name: string,
  category: string,
  supplier: number,
  cost: number,
  price: number,
  minStock: number,
  stock: DemoStock,
  shelfLifeDays: number | null,
  baseUnit: string,
  extraUnits: [string, number, number][] = []
): DemoProduct {
  return {
    sku,
    name,
    category,
    supplier,
    cost,
    minStock,
    stock,
    shelfLifeDays,
    units: [
      { name: baseUnit, factor: 1, price },
      ...extraUnits.map(([unitName, factor, price]) => ({ name: unitName, factor, price })),
    ],
  };
}

const KERING = 'Tepung & Bahan Kering';
const PEMANIS = 'Gula & Pemanis';
const LEMAK = 'Lemak & Mentega';
const SUSU = 'Telur & Susu';
const COKELAT = 'Cokelat & Perasa';
const PENGEMBANG = 'Pengembang & Pewarna';
const KEMASAN = 'Kemasan & Loyang';

/** Short product blurbs; only the lines a shopkeeper would actually write. */
export const THALIA_NOTES: Record<string, string> = {
  'TPG-001': 'Protein tinggi, untuk roti, donat, dan bakso.',
  'TPG-002': 'Serbaguna untuk bolu, kue kering, dan pisang goreng.',
  'TPG-003': 'Protein rendah, hasil kue lebih lembut dan mengembang.',
  'GLA-001': 'Gula kristal putih kemasan 1 kg, curah 50 kg tersedia.',
  'LMK-001': 'Butter tawar, aroma kuat untuk buttercream.',
  'LMK-002': 'Margarin serbaguna, tahan suhu ruang.',
  'CHC-003': 'Couverture 55% kakao, tempering mudah.',
  'KMS-004': 'Box food grade 20x20 cm, alas karton tebal.',
};

export interface DemoRecurringCost {
  category: string;
  /** Index into `THALIA.branches`. */
  branch: number;
  amount: number;
  description: string;
}

export interface DemoOneOffCost extends DemoRecurringCost {
  daysAgo: number;
}

export interface DemoCatalog {
  name: string;
  slug: string;
  address: string;
  phone: string;
  owner: { name: string; email: string };
  /** Shared distribution centre; online sales are picked from here. */
  centralWarehouse: { name: string; address: string };
  branches: DemoBranch[];
  suppliers: DemoSupplier[];
  customers: DemoCustomer[];
  staff: DemoStaff[];
  categories: string[];
  products: DemoProduct[];
  monthlyCosts: DemoRecurringCost[];
  oneOffCosts: DemoOneOffCost[];
}

export const THALIA: DemoCatalog = {
  name: 'Thalia Toko Bahan Kue',
  slug: 'thalia',
  /** Legal-ish address shown on the receipt (the central store). */
  address: 'Jl. Arif Rahman Hakim No. 88, Depok 16411',
  phone: '021-7270 1288',
  owner: { name: 'Surya', email: 'owner@tokobahankue.com' },

  /**
   * The single gudang: a central one behind Toko Pusat on Jl. Arif Rahman
   * Hakim. Every branch order is picked here; walk-in shops also keep a small
   * "rak" (type `store`) that the till sells from, while the online channel is
   * shipped straight out of this gudang.
   */
  centralWarehouse: {
    name: 'Gudang Pusat Depok',
    address: 'Jl. Arif Rahman Hakim No. 96, Depok 16411 (dekat Toko Pusat)',
  },

  branches: [
    {
      name: 'Thalia Toko Pusat',
      code: 'THL-01',
      type: 'hybrid',
      address: 'Jl. Arif Rahman Hakim No. 88, Depok 16411',
      phone: '021-7270 1288',
      target: 45_000_000,
      shelf: { name: 'Rak Toko Pusat', code: 'RK-THL-01' },
    },
    {
      name: 'Thalia Toko 2',
      code: 'THL-02',
      type: 'store',
      address: 'Jl. Margonda Raya No. 210, Depok 16424',
      phone: '021-7720 3390',
      target: 32_000_000,
      shelf: { name: 'Rak Toko 2', code: 'RK-THL-02' },
    },
    {
      name: 'Thalia Online',
      code: 'THL-03',
      type: 'online',
      address: 'tokobahankue.com (dikirim dari Gudang Pusat Depok)',
      phone: '0812-1000 2277',
      target: 25_000_000,
      // No shelf: web orders are picked at the gudang and shipped out.
      shelf: null,
    },
  ],

  suppliers: [
    {
      name: 'CV Aroma Pangan Nusantara',
      contact: 'Hendra Gunawan',
      phone: '0812-2211-9087',
      email: 'sales@aromapangan.co.id',
      address: 'Jl. Soekarno Hatta No. 512, Bandung',
      category: 'distributor',
      legalName: 'CV Aroma Pangan Nusantara',
      city: 'Bandung',
      province: 'Jawa Barat',
      postalCode: '40266',
      taxId: '01.234.567.8-423.000',
      website: 'https://aromapangan.co.id',
      termsDays: 30,
      leadTimeDays: 3,
      rating: 5,
      creditLimit: 15_000_000,
      bankName: 'Bank Mandiri',
      bankAccountNumber: '130-00-1234567-8',
      bankAccountName: 'CV Aroma Pangan Nusantara',
      notes: 'Bahan kering utama: gula, cokelat, dan bahan pengembang.',
    },
    {
      name: 'PT Sumber Terigu Sejahtera',
      contact: 'Lina Marlina',
      phone: '0813-4477-1120',
      email: 'order@sumberterigu.id',
      address: 'Kawasan Industri Cikarang Blok C-7, Bekasi',
      category: 'manufacturer',
      legalName: 'PT Sumber Terigu Sejahtera',
      city: 'Bekasi',
      province: 'Jawa Barat',
      postalCode: '17530',
      taxId: '02.345.678.9-407.000',
      website: 'https://sumberterigu.id',
      termsDays: 45,
      leadTimeDays: 7,
      rating: 5,
      creditLimit: 40_000_000,
      bankName: 'Bank BCA',
      bankAccountNumber: '527-088-9911',
      bankAccountName: 'PT Sumber Terigu Sejahtera',
      notes: 'Produsen tepung protein tinggi dan sedang, kirim tiap Selasa.',
    },
    {
      name: 'Toko Emas Mentega Jaya',
      contact: 'Rudi Hartono',
      phone: '0821-1188-4455',
      email: 'emasmentega@gmail.com',
      address: 'Pasar Baru Lantai 2 Blok A-14, Bandung',
      category: 'trader',
      legalName: 'Toko Emas Mentega Jaya',
      city: 'Bandung',
      province: 'Jawa Barat',
      postalCode: '40181',
      taxId: '03.456.789.0-423.000',
      website: '',
      termsDays: 14,
      leadTimeDays: 2,
      rating: 4,
      creditLimit: 5_000_000,
      bankName: 'Bank BRI',
      bankAccountNumber: '0093-01-002211-30-1',
      bankAccountName: 'Rudi Hartono',
      notes: 'Mentega dan margarin curah, pembayaran tempo 2 minggu.',
    },
    {
      name: 'CV Dairy Prima Nusantara',
      contact: 'Melisa Tanuwijaya',
      phone: '0811-2277-6690',
      email: 'cs@dairyprima.co.id',
      address: 'Jl. Kopo Sayati No. 88, Bandung',
      category: 'distributor',
      legalName: 'CV Dairy Prima Nusantara',
      city: 'Bandung',
      province: 'Jawa Barat',
      postalCode: '40228',
      taxId: '04.567.890.1-423.000',
      website: 'https://dairyprima.co.id',
      termsDays: 21,
      leadTimeDays: 2,
      rating: 4,
      creditLimit: 12_000_000,
      bankName: 'Bank Mandiri',
      bankAccountNumber: '130-00-7654321-0',
      bankAccountName: 'CV Dairy Prima Nusantara',
      notes: 'Susu, krim, dan keju — barang dingin, kirim pagi.',
    },
    {
      name: 'Kemasan Kreatif Bandung',
      contact: 'Siti Aminah',
      phone: '0822-9900-3311',
      email: 'halo@kemasankreatif.id',
      address: 'Jl. Cigondewah Kaler No. 27, Bandung',
      category: 'manufacturer',
      legalName: 'CV Kemasan Kreatif Bandung',
      city: 'Bandung',
      province: 'Jawa Barat',
      postalCode: '40218',
      taxId: '05.678.901.2-423.000',
      website: 'https://kemasankreatif.id',
      termsDays: 30,
      leadTimeDays: 5,
      rating: 3,
      creditLimit: 8_000_000,
      bankName: 'Bank BNI',
      bankAccountNumber: '0987-654-321',
      bankAccountName: 'CV Kemasan Kreatif Bandung',
      notes: 'Box, kertas roti, dan kemasan custom sablon.',
    },
  ],

  customers: [
    {
      name: 'Dapur Bu Rina',
      phone: '0812-3344-5566',
      email: 'dapurburina@gmail.com',
      address: 'Jl. Kukusan Teknik Raya No. 12, Depok',
      notes: 'Langganan tepung 25 kg tiap 2 minggu.',
    },
    {
      name: 'Kue Kering Ayu',
      phone: '0857-2200-1188',
      email: 'kuekering.ayu@gmail.com',
      address: 'Jl. Margonda Raya No. 9, Depok',
      notes: 'Ramai menjelang Lebaran dan Natal.',
    },
    {
      name: 'Roti Harum Bakery',
      phone: '0813-5566-7799',
      email: 'order@rotiharum.id',
      address: 'Jl. Raya Bogor No. 244, Depok',
      notes: 'Bayar tempo 14 hari.',
    },
    {
      name: 'Catering Selera Bunda',
      phone: '0821-7788-9900',
      email: 'selerabunda@gmail.com',
      address: 'Jl. Sawangan Raya No. 71, Depok',
      notes: 'Order mendadak untuk acara kantor.',
    },
    {
      name: 'Toko Kue Mawar',
      phone: '0838-1122-3344',
      email: 'tokokue.mawar@gmail.com',
      address: 'Jl. Cinere Raya No. 3, Depok',
      notes: 'Sering titip nota, minta struk rangkap.',
    },
    {
      name: 'Warung Kue Neng Iis',
      phone: '0896-3311-2255',
      email: 'nengiis.kue@gmail.com',
      address: 'Jl. Cimanggis Raya No. 55, Depok',
      notes: 'Beli gula dan telur tiap pagi.',
    },
  ],

  staff: [
    {
      name: 'Dewi Lestari',
      email: 'dewi@tokobahankue.com',
      role: 'tenant_admin',
      branch: 0,
      salary: 6_500_000,
    },
    {
      name: 'Rina Kurnia',
      email: 'rina@tokobahankue.com',
      role: 'store_manager',
      branch: 1,
      salary: 5_000_000,
    },
    {
      name: 'Bayu Pratama',
      email: 'bayu@tokobahankue.com',
      role: 'cashier',
      branch: 0,
      salary: 3_800_000,
    },
    {
      name: 'Fitri Handayani',
      email: 'fitri@tokobahankue.com',
      role: 'cashier',
      branch: 1,
      salary: 3_800_000,
    },
    {
      name: 'Agus Salim',
      email: 'agus@tokobahankue.com',
      role: 'warehouse',
      branch: 0,
      salary: 4_000_000,
    },
    {
      name: 'Sari Melati',
      email: 'sari@tokobahankue.com',
      role: 'staff',
      branch: 1,
      salary: 3_300_000,
    },
    {
      name: 'Yoga Saputra',
      email: 'yoga@tokobahankue.com',
      role: 'cashier',
      branch: 2,
      salary: 3_800_000,
    },
    {
      name: 'Nadia Safitri',
      email: 'nadia@tokobahankue.com',
      role: 'staff',
      branch: 2,
      salary: 3_500_000,
    },
  ],

  categories: [KERING, PEMANIS, LEMAK, SUSU, COKELAT, PENGEMBANG, KEMASAN],

  products: [
    product('TPG-001', 'Tepung Terigu Cakra Kembar', KERING, 1, 13_500, 15_500, 25, { central: 70, shelves: [30, 20] }, 270, 'kg', [
      ['karung', 25, 355_000],
    ]),
    product('TPG-002', 'Tepung Terigu Segitiga Biru', KERING, 1, 12_500, 14_500, 25, { central: 90, shelves: [35, 25] }, 270, 'kg', [
      ['karung', 25, 335_000],
    ]),
    product('TPG-003', 'Tepung Kunci Biru', KERING, 1, 13_000, 15_500, 20, { central: 45, shelves: [20, 15] }, 270, 'kg', [
      ['karung', 25, 360_000],
    ]),
    product('TPG-004', 'Tepung Maizena', KERING, 0, 18_000, 21_500, 10, { central: 25, shelves: [12, 8] }, 365, 'kg', [
      ['pack', 0.5, 11_500],
    ]),
    product('TPG-005', 'Tepung Beras', KERING, 0, 14_000, 17_000, 8, { central: 18, shelves: [7, 5] }, 365, 'kg', [
      ['pack', 0.5, 9_500],
    ]),
    product('GLA-001', 'Gula Pasir Premium', PEMANIS, 1, 15_000, 18_000, 30, { central: 120, shelves: [50, 30] }, 540, 'kg', [
      ['karung', 50, 790_000],
    ]),
    product('GLA-002', 'Gula Halus Icing', PEMANIS, 1, 19_000, 23_000, 15, { central: 34, shelves: [16, 10] }, 540, 'kg', [
      ['pack', 0.5, 12_500],
    ]),
    product('GLA-003', 'Gula Aren Bubuk', PEMANIS, 0, 27_000, 33_000, 8, { central: 10, shelves: [5, 3] }, 180, 'kg'),
    product('LMK-001', 'Mentega Tawar Wisman', LEMAK, 2, 94_000, 112_000, 10, { central: 14, shelves: [7, 5] }, 180, 'kg', [
      ['pack', 0.5, 59_000],
    ]),
    product('LMK-002', 'Margarin Blue Band', LEMAK, 2, 31_000, 38_000, 15, { central: 26, shelves: [12, 10] }, 270, 'kg', [
      ['dus', 12, 400_000],
    ]),
    product('LMK-003', 'Mentega Putih Shortening', LEMAK, 2, 27_000, 34_000, 20, { central: 6, shelves: [5, 3] }, 270, 'kg'),
    product('LMK-004', 'Minyak Sayur', LEMAK, 0, 17_500, 21_000, 20, { central: 32, shelves: [16, 12] }, 365, 'liter', [
      ['jerigen', 18, 345_000],
    ]),
    product('TLR-001', 'Telur Ayam Negeri', SUSU, 2, 26_500, 31_000, 20, { central: 30, shelves: [15, 10] }, 21, 'kg', [
      ['tray', 1.8, 56_000],
    ]),
    product('TLR-002', 'Susu Bubuk Full Cream 400g', SUSU, 3, 42_000, 49_000, 12, { central: 20, shelves: [10, 6] }, 365, 'pcs', [
      ['dus', 12, 500_000],
    ]),
    product('TLR-003', 'Susu Kental Manis 490g', SUSU, 3, 12_500, 15_000, 24, { central: 40, shelves: [18, 14] }, 365, 'kaleng', [
      ['dus', 48, 590_000],
    ]),
    product('TLR-004', 'Whipping Cream 1L', SUSU, 3, 36_000, 44_000, 10, { central: 12, shelves: [4, 2] }, 90, 'liter', [
      ['dus', 12, 415_000],
    ]),
    product('TLR-005', 'Keju Cheddar Blok 2kg', SUSU, 3, 142_000, 168_000, 6, { central: 7, shelves: [2, 2] }, 180, 'pcs'),
    product('CHC-001', 'Cokelat Bubuk Premium', COKELAT, 0, 62_000, 74_000, 10, { central: 18, shelves: [8, 6] }, 365, 'kg', [
      ['pack', 0.5, 38_000],
    ]),
    product('CHC-002', 'Cokelat Compound Batang', COKELAT, 0, 47_000, 57_000, 15, { central: 24, shelves: [10, 8] }, 240, 'kg'),
    product('CHC-003', 'Dark Chocolate Couverture 1kg', COKELAT, 0, 132_000, 158_000, 12, { central: 2, shelves: [2, 2] }, 365, 'pcs', [
      ['dus', 10, 1_450_000],
    ]),
    product('PGR-001', 'Baking Powder 100g', PENGEMBANG, 0, 8_000, 11_000, 30, { central: 46, shelves: [22, 16] }, 540, 'pcs', [
      ['dus', 24, 175_000],
    ]),
    product('PGR-002', 'Soda Kue 100g', PENGEMBANG, 0, 7_000, 9_500, 24, { central: 32, shelves: [16, 12] }, 540, 'pcs', [
      ['dus', 24, 152_000],
    ]),
    product('PGR-003', 'Vanili Essens 30ml', PENGEMBANG, 0, 6_500, 9_000, 40, { central: 8, shelves: [7, 5] }, 730, 'pcs', [
      ['dus', 12, 62_000],
    ]),
    product('PGR-004', 'Pewarna Makanan Set 12 Warna', PENGEMBANG, 0, 21_000, 27_000, 12, { central: 16, shelves: [8, 6] }, 1095, 'pcs'),
    product('KMS-001', 'Loyang Bulat 20 cm', KEMASAN, 4, 38_000, 52_000, 8, { central: 9, shelves: [4, 3] }, null, 'pcs', [
      ['dus', 12, 420_000],
    ]),
    product('KMS-002', 'Kertas Roti Roll 38 cm', KEMASAN, 4, 15_000, 21_000, 10, { central: 13, shelves: [6, 5] }, 730, 'pcs', [
      ['dus', 10, 165_000],
    ]),
    product('KMS-003', 'Piping Bag 100 pcs', KEMASAN, 4, 17_500, 25_000, 30, { central: 4, shelves: [4, 4] }, null, 'pack'),
    product('KMS-004', 'Box Kue 20x20 Putih', KEMASAN, 4, 4_500, 7_000, 100, { central: 240, shelves: [100, 80] }, null, 'pcs', [
      ['dus', 50, 215_000],
    ]),
  ],

  /** Recurring monthly cost per branch index (IDR). */
  monthlyCosts: [
    { category: 'Sewa Tempat', branch: 0, amount: 8_500_000, description: 'Sewa ruko Thalia Toko Pusat' },
    { category: 'Sewa Tempat', branch: 1, amount: 4_500_000, description: 'Sewa ruko Thalia Toko 2' },
    { category: 'Sewa Tempat', branch: 2, amount: 3_500_000, description: 'Sewa Gudang Pusat Depok untuk kanal online' },
    { category: 'Listrik & Air', branch: 0, amount: 1_250_000, description: 'Listrik dan air Toko Pusat' },
    { category: 'Listrik & Air', branch: 1, amount: 780_000, description: 'Listrik dan air Toko 2' },
    { category: 'Internet & Telepon', branch: 0, amount: 650_000, description: 'Internet toko dan telepon' },
    { category: 'Internet & Telepon', branch: 2, amount: 750_000, description: 'Hosting tokobahankue.com dan iklan marketplace' },
  ],

  /** One-off operating costs, each `daysAgo` from the run date. */
  oneOffCosts: [
    { category: 'Promosi', branch: 0, amount: 750_000, description: 'Iklan Instagram 3 hari', daysAgo: 6 },
    { category: 'Promosi', branch: 2, amount: 1_200_000, description: 'Iklan tokobahankue.com dan gratis ongkir', daysAgo: 9 },
    { category: 'Perlengkapan Toko', branch: 1, amount: 450_000, description: 'Rak display dan label harga', daysAgo: 19 },
    { category: 'Transportasi', branch: 0, amount: 320_000, description: 'Ongkir pengambilan barang supplier', daysAgo: 11 },
    { category: 'Perlengkapan Toko', branch: 0, amount: 285_000, description: 'Plastik kemasan dan lakban', daysAgo: 3 },
    { category: 'Lainnya', branch: 1, amount: 175_000, description: 'Service timbangan digital', daysAgo: 24 },
  ],
};
