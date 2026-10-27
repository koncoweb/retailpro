/**
 * Report period helpers.
 *
 * Two things go wrong when reports bucket time with `CURRENT_DATE` and a bare
 * `strftime('%Y-%m', created_at)`:
 *
 *  1. an open-ended `>=` window is not reproducible (it silently grows while
 *     the user looks at the page) and blocks an index range scan;
 *  2. `created_at` is stored as UTC, so a sale rung up at 00:30 local time on
 *     the first of the month is bucketed into the previous month.
 *
 * The range is therefore returned as an explicit `[start, endExclusive)` pair
 * in UTC, and month bucketing shifts the value into local time first.
 */

export type ReportPeriod = 'today' | 'thisweek' | 'thismonth' | 'thisyear';

/**
 * `[start, endExclusive)` as ISO-8601 UTC strings.
 *
 * Weeks start on Monday. Passing `now` keeps this testable.
 */
export function getPeriodRange(period: string, now: Date = new Date()): [string, string] {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const tomorrow = new Date(year, month, day + 1);

  switch (period as ReportPeriod) {
    case 'today':
      return [new Date(year, month, day).toISOString(), tomorrow.toISOString()];

    case 'thisweek': {
      // getDay() is 0 for Sunday, so Sunday belongs to the week that started
      // six days earlier.
      const weekday = now.getDay() === 0 ? 7 : now.getDay();
      return [new Date(year, month, day - (weekday - 1)).toISOString(), tomorrow.toISOString()];
    }

    case 'thisyear':
      return [new Date(year, 0, 1).toISOString(), new Date(year + 1, 0, 1).toISOString()];

    case 'thismonth':
    default:
      return [new Date(year, month, 1).toISOString(), new Date(year, month + 1, 1).toISOString()];
  }
}

/**
 * SQLite modifier that shifts a stored UTC timestamp into the browser's local
 * time, e.g. `'+7 hours'`. Bind it as a parameter:
 *
 *   `strftime('%Y-%m', created_at, ?)`
 *
 * Calendar months are a local-time concept, so bucketing without this puts
 * late-evening sales in the wrong month for any UTC+ timezone.
 */
export function sqliteTzModifier(at: Date = new Date()): string {
  const offsetHours = -at.getTimezoneOffset() / 60;
  const sign = offsetHours >= 0 ? '+' : '-';
  return `${sign}${Math.abs(offsetHours)} hours`;
}

/** Start of the month `monthsBack` months ago, as a UTC ISO string. */
export function startOfMonthOffset(monthsBack: number, now: Date = new Date()): string {
  return new Date(now.getFullYear(), now.getMonth() - monthsBack, 1).toISOString();
}
