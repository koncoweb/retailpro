/**
 * Indonesian public holidays (Hari Libur Nasional) and collective leave days
 * (Cuti Bersama), loaded per year.
 *
 * The Libur tab used to render a hard-coded array for a single year, so every
 * 1 January the list silently went stale. The list now comes from the Tanggal
 * Merah API (https://tanggalmerah.upset.dev), which publishes the government
 * decree per year — national holidays and cuti bersama together — and answers
 * for every year it knows via `/api/years`. A year selector loads the matching
 * set; the current year is the default, so crossing into a new year refreshes
 * the table without any manual re-entry.
 *
 * Offline (or when the API is down) the bundled fallback for the current year
 * keeps the tab useful; a stale cached list is never shown for another year.
 */

export type HolidayType = 'holiday' | 'leave';

export interface HolidayEntry {
  /** `YYYY-MM-DD`. */
  date: string;
  name: string;
  type: HolidayType;
}

export interface HolidayYearResult {
  year: number;
  holidays: HolidayEntry[];
  /** True when the API was unreachable and the bundled list was used. */
  fallback: boolean;
}

const API_BASE = 'https://tanggalmerah.upset.dev';

/** Response envelope of every Tanggal Merah endpoint. */
interface ApiHoliday {
  date: string;
  name: string;
  type: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/**
 * Years bundled in the app, kept in step with what the API covers so a first
 * run offline still shows the running year.
 */
const FALLBACK_HOLIDAYS: Record<number, HolidayEntry[]> = {
  2026: [
    { date: '2026-01-01', name: 'Tahun Baru 2026 Masehi', type: 'holiday' },
    { date: '2026-01-16', name: "Isra Mi'raj Nabi Muhammad SAW", type: 'holiday' },
    { date: '2026-02-16', name: 'Tahun Baru Imlek 2577 Kongzili', type: 'leave' },
    { date: '2026-02-17', name: 'Tahun Baru Imlek 2577 Kongzili', type: 'holiday' },
    { date: '2026-03-18', name: 'Hari Suci Nyepi Tahun Baru Saka 1948', type: 'leave' },
    { date: '2026-03-19', name: 'Hari Suci Nyepi Tahun Baru Saka 1948', type: 'holiday' },
    { date: '2026-03-20', name: 'Hari Raya Idul Fitri 1447 Hijriyah', type: 'leave' },
    { date: '2026-03-21', name: 'Hari Raya Idul Fitri 1447 Hijriyah', type: 'holiday' },
    { date: '2026-03-22', name: 'Hari Raya Idul Fitri 1447 Hijriyah', type: 'holiday' },
    { date: '2026-03-23', name: 'Hari Raya Idul Fitri 1447 Hijriyah', type: 'leave' },
    { date: '2026-03-24', name: 'Hari Raya Idul Fitri 1447 Hijriyah', type: 'leave' },
    { date: '2026-04-03', name: 'Wafat Yesus Kristus / Jumat Agung', type: 'holiday' },
    { date: '2026-04-05', name: 'Kebangkitan Yesus Kristus (Paskah)', type: 'holiday' },
    { date: '2026-05-01', name: 'Hari Buruh Internasional', type: 'holiday' },
    { date: '2026-05-14', name: 'Kenaikan Yesus Kristus', type: 'holiday' },
    { date: '2026-05-15', name: 'Kenaikan Yesus Kristus', type: 'leave' },
    { date: '2026-05-27', name: 'Hari Raya Idul Adha 1447 Hijriyah', type: 'holiday' },
    { date: '2026-05-28', name: 'Hari Raya Idul Adha 1447 Hijriyah', type: 'leave' },
    { date: '2026-05-31', name: 'Hari Raya Waisak 2570 BE', type: 'holiday' },
    { date: '2026-06-01', name: 'Hari Lahir Pancasila', type: 'holiday' },
    { date: '2026-06-16', name: 'Tahun Baru Islam 1448 Hijriyah', type: 'holiday' },
    { date: '2026-08-17', name: 'Hari Kemerdekaan Republik Indonesia', type: 'holiday' },
    { date: '2026-08-25', name: 'Maulid Nabi Muhammad SAW', type: 'holiday' },
    { date: '2026-12-24', name: 'Hari Raya Natal', type: 'leave' },
    { date: '2026-12-25', name: 'Hari Raya Natal', type: 'holiday' },
  ],
};

/** One trip per year per session; the decree for a year never changes mid-day. */
const cache = new Map<number, HolidayYearResult>();

function normalizeType(value: string): HolidayType {
  return value === 'leave' ? 'leave' : 'holiday';
}

/** API entries sorted by date; fallback entries are already in order. */
function sortHolidays(entries: HolidayEntry[]): HolidayEntry[] {
  return [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Holiday API responded ${response.status}`);
  }
  const envelope = (await response.json()) as ApiEnvelope<T>;
  if (!envelope.success) {
    throw new Error('Holiday API returned an error envelope');
  }
  return envelope.data;
}

function fallbackFor(year: number): HolidayYearResult {
  return {
    year,
    holidays: FALLBACK_HOLIDAYS[year] ?? [],
    fallback: (FALLBACK_HOLIDAYS[year] ?? []).length > 0,
  };
}

/**
 * Loads the holiday list for one year. Network failures degrade to the bundled
 * fallback instead of throwing, because the tab must never show a spinner the
 * user cannot escape.
 */
export async function fetchHolidaysForYear(year: number): Promise<HolidayYearResult> {
  const cached = cache.get(year);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const data = await fetchJson<ApiHoliday[]>(
      `${API_BASE}/api/holidays?year=${year}`,
      controller.signal
    );
    const result: HolidayYearResult = {
      year,
      holidays: sortHolidays(
        data.map((entry) => ({
          date: entry.date,
          name: entry.name,
          type: normalizeType(entry.type),
        }))
      ),
      fallback: false,
    };
    cache.set(year, result);
    return result;
  } catch {
    return fallbackFor(year);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Years the dataset covers. Falls back to a sensible local span so the year
 * selector is never empty when the API is unreachable.
 */
export async function fetchAvailableYears(): Promise<number[]> {
  const currentYear = new Date().getFullYear();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const data = await fetchJson<number[]>(`${API_BASE}/api/years`, controller.signal);
      if (data.length > 0) return [...data].sort((a, b) => a - b);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // handled by the fallback below
  }
  return [currentYear - 1, currentYear, currentYear + 1];
}
