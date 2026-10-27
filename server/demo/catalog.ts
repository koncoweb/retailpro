/**
 * Reference demo tenant: "Thalia Toko Bahan Kue".
 *
 * A cake-and-bakery ingredient shop in Bandung with two branches. Everything in
 * this file is pure data — no SQL, no I/O — so the seeding script and the test
 * suite share exactly the same catalog.
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
  /** Current stock at [Pusat, Antapani], in base units. */
  stock: [number, number];
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
  category: 'distributor' | 'manufacturer' | 'agent' | 'retailer';
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
  address: string;
  phone: string;
  /** Monthly sales target in IDR (Dashboard branch performance). */
  target: number;
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
  stock: [number, number],
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
  /** Legal-ish address shown on the receipt. */
  address: 'Jl. Raya Cimahi No. 128, Bandung 40191',
  phone: '022-6621 4478',
  owner: { name: 'Thalia Wijaya', email: 'thalia@tokobahankue.id' },

  branches: [
    {
      name: 'Thalia Pusat',
      code: 'THL-01',
      address: 'Jl. Raya Cimahi No. 128, Bandung 40191',
      phone: '022-6621 4478',
      target: 45_000_000,
    },
    {
      name: 'Thalia Antapani',
      code: 'THL-02',
      address: 'Jl. Terusan Jakarta No. 45, Bandung 40291',
      phone: '022-7201 3390',
      target: 40_000_000,
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
      category: 'retailer',
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
      address: 'Jl. Cigadung Raya No. 12, Bandung',
      notes: 'Langganan tepung 25 kg tiap 2 minggu.',
    },
    {
      name: 'Kue Kering Ayu',
      phone: '0857-2200-1188',
      email: 'kuekering.ayu@gmail.com',
      address: 'Jl. Antapani Lama No. 9, Bandung',
      notes: 'Ramai menjelang Lebaran dan Natal.',
    },
    {
      name: 'Roti Harum Bakery',
      phone: '0813-5566-7799',
      email: 'order@rotiharum.id',
      address: 'Jl. Kiaracondong No. 244, Bandung',
      notes: 'Bayar tempo 14 hari.',
    },
    {
      name: 'Catering Selera Bunda',
      phone: '0821-7788-9900',
      email: 'selerabunda@gmail.com',
      address: 'Jl. Buah Batu No. 71, Bandung',
      notes: 'Order mendadak untuk acara kantor.',
    },
    {
      name: 'Toko Kue Mawar',
      phone: '0838-1122-3344',
      email: 'tokokue.mawar@gmail.com',
      address: 'Jl. Cibiru Hilir No. 3, Bandung',
      notes: 'Sering titip nota, minta struk rangkap.',
    },
    {
      name: 'Warung Kue Neng Iis',
      phone: '0896-3311-2255',
      email: 'nengiis.kue@gmail.com',
      address: 'Jl. Derwati Raya No. 55, Bandung',
      notes: 'Beli gula dan telur tiap pagi.',
    },
  ],

  staff: [
    {
      name: 'Dewi Lestari',
      email: 'dewi@tokobahankue.id',
      role: 'tenant_admin',
      branch: 0,
      salary: 6_500_000,
    },
    {
      name: 'Rina Kurnia',
      email: 'rina@tokobahankue.id',
      role: 'store_manager',
      branch: 1,
      salary: 5_000_000,
    },
    {
      name: 'Bayu Pratama',
      email: 'bayu@tokobahankue.id',
      role: 'cashier',
      branch: 0,
      salary: 3_800_000,
    },
    {
      name: 'Fitri Handayani',
      email: 'fitri@tokobahankue.id',
      role: 'cashier',
      branch: 1,
      salary: 3_800_000,
    },
    {
      name: 'Agus Salim',
      email: 'agus@tokobahankue.id',
      role: 'warehouse',
      branch: 0,
      salary: 4_000_000,
    },
    {
      name: 'Sari Melati',
      email: 'sari@tokobahankue.id',
      role: 'staff',
      branch: 1,
      salary: 3_300_000,
    },
  ],

  categories: [KERING, PEMANIS, LEMAK, SUSU, COKELAT, PENGEMBANG, KEMASAN],

  products: [
    product('TPG-001', 'Tepung Terigu Cakra Kembar', KERING, 1, 13_500, 15_500, 25, [120, 45], 270, 'kg', [
      ['karung', 25, 355_000],
    ]),
    product('TPG-002', 'Tepung Terigu Segitiga Biru', KERING, 1, 12_500, 14_500, 25, [150, 60], 270, 'kg', [
      ['karung', 25, 335_000],
    ]),
    product('TPG-003', 'Tepung Kunci Biru', KERING, 1, 13_000, 15_500, 20, [80, 30], 270, 'kg', [
      ['karung', 25, 360_000],
    ]),
    product('TPG-004', 'Tepung Maizena', KERING, 0, 18_000, 21_500, 10, [45, 18], 365, 'kg', [
      ['pack', 0.5, 11_500],
    ]),
    product('TPG-005', 'Tepung Beras', KERING, 0, 14_000, 17_000, 8, [30, 12], 365, 'kg', [
      ['pack', 0.5, 9_500],
    ]),
    product('GLA-001', 'Gula Pasir Premium', PEMANIS, 1, 15_000, 18_000, 30, [200, 80], 540, 'kg', [
      ['karung', 50, 790_000],
    ]),
    product('GLA-002', 'Gula Halus Icing', PEMANIS, 1, 19_000, 23_000, 15, [60, 22], 540, 'kg', [
      ['pack', 0.5, 12_500],
    ]),
    product('GLA-003', 'Gula Aren Bubuk', PEMANIS, 0, 27_000, 33_000, 8, [18, 6], 180, 'kg'),
    product('LMK-001', 'Mentega Tawar Wisman', LEMAK, 2, 94_000, 112_000, 10, [26, 9], 180, 'kg', [
      ['pack', 0.5, 59_000],
    ]),
    product('LMK-002', 'Margarin Blue Band', LEMAK, 2, 31_000, 38_000, 15, [48, 16], 270, 'kg', [
      ['dus', 12, 400_000],
    ]),
    product('LMK-003', 'Mentega Putih Shortening', LEMAK, 2, 27_000, 34_000, 20, [14, 5], 270, 'kg'),
    product('LMK-004', 'Minyak Sayur', LEMAK, 0, 17_500, 21_000, 20, [60, 20], 365, 'liter', [
      ['jerigen', 18, 345_000],
    ]),
    product('TLR-001', 'Telur Ayam Negeri', SUSU, 2, 26_500, 31_000, 20, [55, 18], 21, 'kg', [
      ['tray', 1.8, 56_000],
    ]),
    product('TLR-002', 'Susu Bubuk Full Cream 400g', SUSU, 3, 42_000, 49_000, 12, [36, 12], 365, 'pcs', [
      ['dus', 12, 500_000],
    ]),
    product('TLR-003', 'Susu Kental Manis 490g', SUSU, 3, 12_500, 15_000, 24, [72, 24], 365, 'kaleng', [
      ['dus', 48, 590_000],
    ]),
    product('TLR-004', 'Whipping Cream 1L', SUSU, 3, 36_000, 44_000, 10, [18, 6], 90, 'liter', [
      ['dus', 12, 415_000],
    ]),
    product('TLR-005', 'Keju Cheddar Blok 2kg', SUSU, 3, 142_000, 168_000, 6, [11, 4], 180, 'pcs'),
    product('CHC-001', 'Cokelat Bubuk Premium', COKELAT, 0, 62_000, 74_000, 10, [32, 12], 365, 'kg', [
      ['pack', 0.5, 38_000],
    ]),
    product('CHC-002', 'Cokelat Compound Batang', COKELAT, 0, 47_000, 57_000, 15, [42, 15], 240, 'kg'),
    product('CHC-003', 'Dark Chocolate Couverture 1kg', COKELAT, 0, 132_000, 158_000, 12, [6, 2], 365, 'pcs', [
      ['dus', 10, 1_450_000],
    ]),
    product('PGR-001', 'Baking Powder 100g', PENGEMBANG, 0, 8_000, 11_000, 30, [84, 28], 540, 'pcs', [
      ['dus', 24, 175_000],
    ]),
    product('PGR-002', 'Soda Kue 100g', PENGEMBANG, 0, 7_000, 9_500, 24, [60, 20], 540, 'pcs', [
      ['dus', 24, 152_000],
    ]),
    product('PGR-003', 'Vanili Essens 30ml', PENGEMBANG, 0, 6_500, 9_000, 40, [20, 8], 730, 'pcs', [
      ['dus', 12, 62_000],
    ]),
    product('PGR-004', 'Pewarna Makanan Set 12 Warna', PENGEMBANG, 0, 21_000, 27_000, 12, [30, 10], 1095, 'pcs'),
    product('KMS-001', 'Loyang Bulat 20 cm', KEMASAN, 4, 38_000, 52_000, 8, [16, 6], null, 'pcs', [
      ['dus', 12, 420_000],
    ]),
    product('KMS-002', 'Kertas Roti Roll 38 cm', KEMASAN, 4, 15_000, 21_000, 10, [24, 10], 730, 'pcs', [
      ['dus', 10, 165_000],
    ]),
    product('KMS-003', 'Piping Bag 100 pcs', KEMASAN, 4, 17_500, 25_000, 30, [12, 4], null, 'pack'),
    product('KMS-004', 'Box Kue 20x20 Putih', KEMASAN, 4, 4_500, 7_000, 100, [420, 150], null, 'pcs', [
      ['dus', 50, 215_000],
    ]),
  ],

  /** Recurring monthly cost per branch index (IDR). */
  monthlyCosts: [
    { category: 'Sewa Tempat', branch: 0, amount: 8_500_000, description: 'Sewa ruko Thalia Pusat' },
    { category: 'Sewa Tempat', branch: 1, amount: 4_500_000, description: 'Sewa kios Thalia Antapani' },
    { category: 'Listrik & Air', branch: 0, amount: 1_250_000, description: 'Listrik dan air Pusat' },
    { category: 'Listrik & Air', branch: 1, amount: 780_000, description: 'Listrik dan air Antapani' },
    { category: 'Internet & Telepon', branch: 0, amount: 650_000, description: 'Internet toko dan telepon' },
  ],

  /** One-off operating costs, each `daysAgo` from the run date. */
  oneOffCosts: [
    { category: 'Promosi', branch: 0, amount: 750_000, description: 'Iklan Instagram 3 hari', daysAgo: 6 },
    { category: 'Perlengkapan Toko', branch: 1, amount: 450_000, description: 'Rak display dan label harga', daysAgo: 19 },
    { category: 'Transportasi', branch: 0, amount: 320_000, description: 'Ongkir pengambilan barang supplier', daysAgo: 11 },
    { category: 'Perlengkapan Toko', branch: 0, amount: 285_000, description: 'Plastik kemasan dan lakban', daysAgo: 3 },
    { category: 'Lainnya', branch: 1, amount: 175_000, description: 'Service timbangan digital', daysAgo: 24 },
  ],
};
