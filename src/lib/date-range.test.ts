/**
 * Report period maths.
 *
 * These assertions exist because the range is now an explicit
 * `[start, endExclusive)` pair: an off-by-one here silently drops the last day
 * of a report or double-counts the first.
 */
import { describe, expect, it } from 'vitest';
import { getPeriodRange, sqliteTzModifier, startOfMonthOffset } from './date-range';

const at = (iso: string) => new Date(`${iso}T10:00:00`);

describe('getPeriodRange', () => {
  it('covers exactly today for "today"', () => {
    const [start, end] = getPeriodRange('today', at('2026-03-15'));
    expect(new Date(start).getDate()).toBe(15);
    expect(new Date(start).getHours()).toBe(0);
    expect(new Date(end).getDate()).toBe(16);
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(24 * 3600 * 1000);
  });

  it('starts the week on Monday', () => {
    // 2026-03-15 is a Sunday, so the week began on Monday 2026-03-09.
    const [start] = getPeriodRange('thisweek', at('2026-03-15'));
    expect(new Date(start).getDate()).toBe(9);
    expect(new Date(start).getDay()).toBe(1);
  });

  it('spans the whole calendar month for "thismonth"', () => {
    const [start, end] = getPeriodRange('thismonth', at('2026-03-15'));
    expect(new Date(start).getDate()).toBe(1);
    expect(new Date(start).getMonth()).toBe(2);
    expect(new Date(end).getMonth()).toBe(3);
    expect(new Date(end).getDate()).toBe(1);
  });

  it('spans the calendar year for "thisyear"', () => {
    const [start, end] = getPeriodRange('thisyear', at('2026-03-15'));
    expect(new Date(start).getFullYear()).toBe(2026);
    expect(new Date(start).getMonth()).toBe(0);
    expect(new Date(end).getFullYear()).toBe(2027);
    expect(new Date(end).getMonth()).toBe(0);
  });

  it('returns ISO-8601 strings that sort lexicographically in time order', () => {
    const [start, end] = getPeriodRange('thismonth', at('2026-03-15'));
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(start < end).toBe(true);
  });
});

describe('sqliteTzModifier', () => {
  it('renders a signed hour offset that SQLite can use as a modifier', () => {
    // getTimezoneOffset is minutes *behind* UTC for positive offsets.
    const fake = { getTimezoneOffset: () => -420 } as unknown as Date;
    expect(sqliteTzModifier(fake)).toBe('+7 hours');

    const west = { getTimezoneOffset: () => 300 } as unknown as Date;
    expect(sqliteTzModifier(west)).toBe('-5 hours');

    const halfHour = { getTimezoneOffset: () => -330 } as unknown as Date;
    expect(sqliteTzModifier(halfHour)).toBe('+5.5 hours');
  });
});

describe('startOfMonthOffset', () => {
  it('walks back whole months from the first of the month', () => {
    // 2026-03-15 minus 5 months -> 2025-10-01, the first of a six-month window
    // (Oct, Nov, Dec, Jan, Feb, Mar).
    const start = new Date(startOfMonthOffset(5, at('2026-03-15')));
    expect(start.getFullYear()).toBe(2025);
    expect(start.getMonth()).toBe(9);
    expect(start.getDate()).toBe(1);
  });
});
