/**
 * Branch resolution precedence — the fix behind "shift belum dibuka" even
 * though the cashier had just opened one. If the till and the shift desk ever
 * disagree about which branch they are standing in, the shift lookup misses
 * and the register locks itself out, so the ordering rules get a test.
 */
import { describe, expect, it } from 'vitest';
import { pickPosBranch, type PosBranchRow } from './use-pos-branch';

const rows: PosBranchRow[] = [
  { id: 'b-bdg', name: 'Bandung' },
  { id: 'b-jkt', name: 'Jakarta' },
  { id: 'b-sby', name: 'Surabaya' },
];

describe('pickPosBranch', () => {
  it('prefers the branch carried by the tenant session', () => {
    expect(
      pickPosBranch(rows, {
        sessionBranchId: 'b-jkt',
        assignedBranchId: 'b-sby',
        scope: null,
      })
    ).toBe('b-jkt');
  });

  it('falls back to the assigned branch when the session has none', () => {
    expect(
      pickPosBranch(rows, {
        sessionBranchId: null,
        assignedBranchId: 'b-bdg',
        scope: null,
      })
    ).toBe('b-bdg');
  });

  it('takes the first in-scope branch for staff without an assignment', () => {
    // A cashier whose role scope covers Jakarta + Surabaya, in name order.
    expect(
      pickPosBranch(rows, {
        sessionBranchId: null,
        assignedBranchId: null,
        scope: ['b-jkt', 'b-sby'],
      })
    ).toBe('b-jkt');
  });

  it('ignores a session branch the role scope no longer allows', () => {
    // Owner moved the person to another branch but the old session id is
    // still cached: the scope wins, otherwise the POS would transact where
    // the person can no longer see stock.
    expect(
      pickPosBranch(rows, {
        sessionBranchId: 'b-jkt',
        assignedBranchId: 'b-sby',
        scope: ['b-bdg', 'b-sby'],
      })
    ).toBe('b-sby');
  });

  it('ignores an assigned branch that is not a row (deleted / wrong tenant)', () => {
    expect(
      pickPosBranch(rows, {
        sessionBranchId: null,
        assignedBranchId: 'b-ghost',
        scope: null,
      })
    ).toBe('b-bdg');
  });

  it('falls back to the first row for a company-wide scope', () => {
    expect(
      pickPosBranch(rows, { sessionBranchId: null, assignedBranchId: null, scope: null })
    ).toBe('b-bdg');
  });

  it('returns null when there is nothing to ring up in', () => {
    expect(
      pickPosBranch([], { sessionBranchId: 'b-jkt', assignedBranchId: null, scope: null })
    ).toBeNull();
    // Scope that excludes every row is the same dead end; the caller shows
    // "Belum ada cabang yang bisa diakses akun ini." instead of a crash.
    expect(
      pickPosBranch(rows, { sessionBranchId: null, assignedBranchId: null, scope: [] })
    ).toBeNull();
  });
});
