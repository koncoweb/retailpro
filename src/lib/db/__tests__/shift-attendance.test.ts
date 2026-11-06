/**
 * Auto check-in/check-out from the POS shift cycle, replayed against a
 * throwaway v8 database — the same harness as `schema.test.ts`, on purpose:
 * these statements are what a cashier's attendance depends on, and a copy
 * of the SQL in the test is free to drift from the copy that ships.
 */
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { translate } from '../translate';
import {
  AUTO_CHECK_IN_INSERT_SQL,
  AUTO_CHECK_IN_SELECT_SQL,
  AUTO_CHECK_OUT_UPDATE_SQL,
  planAutoCheckIn,
  wibParts,
} from '../../shift-attendance';

const root = process.cwd();
const dbPath = path.join(os.tmpdir(), `rp-shift-att-test-${process.pid}-${Date.now()}.db`);

let client: Client;

/** Runs app-style SQL through the real translator, exactly like `query()`. */
async function run<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const translated = translate(sql, params);
  const res = await client.execute({ sql: translated.sql, args: translated.args as never });
  return res.rows as unknown as T[];
}

beforeAll(async () => {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  client = createClient({ url: `file:${dbPath}` });
  const schema = readFileSync(path.join(root, 'db', 'schema', 'tenant.sql'), 'utf8');
  await client.executeMultiple(schema);
});

afterAll(() => {
  client.close();
  try {
    rmSync(dbPath, { force: true });
  } catch {
    // Windows keeps the handle until GC; the temp dir cleans itself.
  }
});

describe('wibParts', () => {
  it('shifts UTC to the Indonesian calendar day and HH:MM clock', () => {
    // 20:00 UTC is 03:00 WIB the next day.
    const parts = wibParts(new Date('2026-07-29T20:00:00Z'));
    expect(parts.date).toBe('2026-07-30');
    expect(parts.time).toBe('03:00');
  });

  it('keeps the same date before midnight WIB', () => {
    // 16:30 UTC is still 2026-07-29 at 23:30 WIB — the calendar day the
    // attendance report buckets by.
    const parts = wibParts(new Date('2026-07-29T16:30:00Z'));
    expect(parts.date).toBe('2026-07-29');
    expect(parts.time).toBe('23:30');
  });

  it('rolls to the next day right at midnight WIB', () => {
    const parts = wibParts(new Date('2026-07-29T17:30:00Z'));
    expect(parts.date).toBe('2026-07-30');
    expect(parts.time).toBe('00:30');
  });
});

describe('planAutoCheckIn', () => {
  it('inserts only when the person has no row for the WIB day yet', () => {
    expect(planAutoCheckIn(0, { date: '2026-07-30', time: '08:15' })).toEqual({
      kind: 'insert',
      date: '2026-07-30',
      checkIn: '08:15',
    });
    // They already checked in at /absen (or a first shift today): no row,
    // no duplicate — the table has no UNIQUE(employee_id, date) to lean on.
    expect(planAutoCheckIn(1, { date: '2026-07-30', time: '08:15' })).toEqual({
      kind: 'skip',
    });
  });
});

describe('shift-driven attendance statements against schema v8', () => {
  const employeeId = 'cashier-shift-test';
  const branchId = 'branch-shift-test';

  it('books exactly one self-sourced present row per opening', async () => {
    const { date, time } = wibParts();

    const before = await run(AUTO_CHECK_IN_SELECT_SQL, [employeeId, date]);
    expect(before).toHaveLength(0);
    const plan = planAutoCheckIn(before.length, { date, time });
    expect(plan.kind).toBe('insert');
    if (plan.kind !== 'insert') return;

    await run(AUTO_CHECK_IN_INSERT_SQL, [employeeId, plan.date, plan.checkIn, branchId]);

    const rows = await run<{
      check_in: string;
      status: string;
      source: string;
      location_type: string;
      location_id: string;
      notes: string;
      check_out: string | null;
    }>(`SELECT * FROM attendance WHERE employee_id = $1 AND date = $2`, [employeeId, date]);
    expect(rows).toHaveLength(1);
    expect(rows[0].check_in).toBe(time);
    expect(rows[0].status).toBe('present');
    expect(rows[0].source).toBe('self');
    expect(rows[0].location_type).toBe('branch');
    expect(rows[0].location_id).toBe(branchId);
    expect(rows[0].notes).toBe('Otomatis dari buka shift');
    expect(rows[0].check_out).toBeNull();

    // A second shift opening must find the row and plan no insert.
    const after = await run(AUTO_CHECK_IN_SELECT_SQL, [employeeId, date]);
    expect(after).toHaveLength(1);
    expect(planAutoCheckIn(after.length, { date, time }).kind).toBe('skip');
  });

  it('stamps check_out only while it is still null', async () => {
    const { date } = wibParts();

    await run(AUTO_CHECK_OUT_UPDATE_SQL, ['17:00', employeeId, date]);
    const rows = await run<{ check_out: string | null }>(
      `SELECT check_out FROM attendance WHERE employee_id = $1 AND date = $2`,
      [employeeId, date]
    );
    expect(rows[0].check_out).toBe('17:00');

    // An /absen (or second-shift) check-out that already landed is never
    // overwritten, even when another shift closes later.
    await run(AUTO_CHECK_OUT_UPDATE_SQL, ['18:30', employeeId, date]);
    const again = await run<{ check_out: string | null }>(
      `SELECT check_out FROM attendance WHERE employee_id = $1 AND date = $2`,
      [employeeId, date]
    );
    expect(again[0].check_out).toBe('17:00');
  });

  it('leaves the update harmless for a cashier with no attendance row', async () => {
    // The UPDATE touches zero rows; the trigger only guards INSERTs, so a
    // close can never fail on the DB layer for somebody who never opened.
    await expect(
      run(AUTO_CHECK_OUT_UPDATE_SQL, ['12:00', 'ghost-cashier', wibParts().date])
    ).resolves.toBeDefined();
  });
});
