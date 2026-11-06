/**
 * Attendance written automatically by the POS shift cycle.
 *
 * A cashier physically standing at a till with an open drawer is the
 * strongest presence evidence the system gets — stronger than a phone GPS —
 * but until now it never reached the `attendance` table, so payroll read
 * "absent" for people who had been selling all morning. Opening a shift now
 * books a check-in, closing one books the check-out.
 *
 * Contract with the callers (§2 of the POS hardening plan):
 *   - Best-effort. These never throw; a failed attendance write surfaces to
 *     the UI as a warning toast but must not roll back or block the shift
 *     itself, which is the cashier's cash accountability record.
 *   - No duplicates. There is no UNIQUE(employee_id, date) on the table and
 *     the today-only trigger only guards INSERT dates, so the read-before-
 *     write here is what keeps a person who already checked in at /absen
 *     from getting a second row when they open a shift.
 *   - WIB conventions match the rest of attendance: the `date` is the
 *     Indonesian calendar day and `check_in`/`check_out` are HH:MM wall
 *     clocks, the same strings the reports split on ':'.
 */
import { query } from "@/lib/db";

/** WIB (UTC+7) calendar day + HH:MM clock, same shape as /absen's wibParts. */
export function wibParts(now: Date = new Date()): { date: string; time: string } {
  const iso = new Date(now.getTime() + 7 * 3_600_000).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/**
 * Pure check-in decision, extracted for the unit test: insert only when the
 * person has no attendance row for the running WIB day yet.
 */
export function planAutoCheckIn(
  existingRowsToday: number,
  parts: { date: string; time: string } = wibParts()
): { kind: "insert"; date: string; checkIn: string } | { kind: "skip" } {
  if (existingRowsToday > 0) return { kind: "skip" };
  return { kind: "insert", date: parts.date, checkIn: parts.time };
}

export interface AutoAttendanceResult {
  ok: boolean;
  /** False when nothing was written — the day already had a row, or closing
   *  found no open check-in to stamp. Lets the UI stay honest about it. */
  changed: boolean;
  /** Present when the attendance write failed; the shift result is unaffected. */
  error?: string;
}

/**
 * The three statements, exported so the schema test can replay them
 * verbatim against a throwaway v8 database instead of a copy that is free
 * to drift.
 */
export const AUTO_CHECK_IN_SELECT_SQL = `SELECT id FROM attendance WHERE employee_id = $1 AND date = $2 LIMIT 1`;
export const AUTO_CHECK_IN_INSERT_SQL = `INSERT INTO attendance
         (employee_id, date, check_in, status, source,
          location_type, location_id, notes)
       VALUES ($1, $2, $3, 'present', 'self',
          'branch', $4, 'Otomatis dari buka shift')`;
export const AUTO_CHECK_OUT_UPDATE_SQL = `UPDATE attendance
          SET check_out = $1
        WHERE employee_id = $2 AND date = $3 AND check_out IS NULL`;

/**
 * Book the day's check-in from opening a shift. `source='self'` because the
 * person performed the action themselves (no owner override, no geofence or
 * face gate — physical presence at the till is evidenced by the shift
 * transaction itself). If the day already has a row — e.g. they checked in
 * at /absen first — nothing is written.
 */
export async function autoCheckInForShift(
  userId: string,
  branchId: string
): Promise<AutoAttendanceResult> {
  try {
    const { date } = wibParts();
    const existing = await query<{ id: string }>(AUTO_CHECK_IN_SELECT_SQL, [
      userId,
      date,
    ]);
    const plan = planAutoCheckIn(existing.rows.length);
    if (plan.kind === "skip") return { ok: true, changed: false };
    await query(AUTO_CHECK_IN_INSERT_SQL, [
      userId,
      plan.date,
      plan.checkIn,
      branchId,
    ]);
    return { ok: true, changed: true };
  } catch (error) {
    console.error("Auto check-in from shift failed:", error);
    return {
      ok: false,
      changed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Stamp the check-out from closing a shift. Only rows still missing a
 * check-out are touched, so an /absen check-out that already happened is
 * never overwritten, and the today-only trigger cannot object because it
 * guards INSERTs only.
 */
export async function autoCheckOutForShift(
  userId: string
): Promise<AutoAttendanceResult> {
  try {
    const { date, time } = wibParts();
    const res = await query(AUTO_CHECK_OUT_UPDATE_SQL, [time, userId, date]);
    return { ok: true, changed: (res.rowCount ?? 0) > 0 };
  } catch (error) {
    console.error("Auto check-out from shift failed:", error);
    return {
      ok: false,
      changed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Shared human-facing warning when the attendance half of a shift failed. */
export function autoAttendanceWarning(result: AutoAttendanceResult): string | null {
  return result.ok
    ? null
    : "Shift tersimpan, tetapi absensi hari ini gagal tercatat. Isi manual di halaman Absen.";
}
