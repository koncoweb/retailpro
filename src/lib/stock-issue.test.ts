import { describe, expect, it } from "vitest";
import {
  compareBatchesForIssue,
  normalizeStockIssueMethod,
  sortBatchesForIssue,
  stockIssueMethodLabel,
  DEFAULT_STOCK_ISSUE_METHOD,
  STOCK_ISSUE_METHODS,
  type IssueBatch,
} from "./stock-issue";

/** Oldest received, still valid for months. */
const older = { id: "b-old", received_at: "2026-01-01T08:00:00.000Z", expiry_date: "2027-06-30" };
/** Newest received, expires soonest. */
const newer = { id: "b-new", received_at: "2026-02-01T08:00:00.000Z", expiry_date: "2026-03-31" };
/** Newest received, never expires. */
const noExpiry = { id: "b-noexp", received_at: "2026-01-15T08:00:00.000Z", expiry_date: null };

const ids = (batches: IssueBatch[]) => batches.map((batch) => batch.id);

describe("stock issue policy", () => {
  it("defaults to FIFO and exposes every method in the settings list", () => {
    expect(DEFAULT_STOCK_ISSUE_METHOD).toBe("fifo");
    expect(STOCK_ISSUE_METHODS.map((method) => method.value)).toEqual(["fifo", "lifo", "fefo"]);
  });

  it("coerces unknown or missing settings to FIFO", () => {
    expect(normalizeStockIssueMethod(undefined)).toBe("fifo");
    expect(normalizeStockIssueMethod(null)).toBe("fifo");
    expect(normalizeStockIssueMethod("")).toBe("fifo");
    expect(normalizeStockIssueMethod("average")).toBe("fifo");
    expect(normalizeStockIssueMethod("FEFO")).toBe("fifo");
    expect(normalizeStockIssueMethod("fefo")).toBe("fefo");
  });

  it("labels a method for the audit trail and toasts", () => {
    expect(stockIssueMethodLabel("fefo")).toContain("FEFO");
    // An out-of-range value never reaches the UI as undefined.
    expect(stockIssueMethodLabel("nope" as never)).toContain("FIFO");
  });

  it("FIFO drains the oldest received batch first", () => {
    expect(ids(sortBatchesForIssue([newer, older, noExpiry], "fifo"))).toEqual([
      older.id,
      noExpiry.id,
      newer.id,
    ]);
  });

  it("LIFO drains the newest received batch first", () => {
    expect(ids(sortBatchesForIssue([older, noExpiry, newer], "lifo"))).toEqual([
      newer.id,
      noExpiry.id,
      older.id,
    ]);
  });

  it("FEFO drains the nearest expiry first and never-expiring batches last", () => {
    // `newer` expires 2026-03-31, `older` 2027-06-30, `noExpiry` has no date at
    // all — so FEFO is neither pure FIFO nor pure LIFO here.
    expect(ids(sortBatchesForIssue([noExpiry, older, newer], "fefo"))).toEqual([
      newer.id,
      older.id,
      noExpiry.id,
    ]);
  });

  it("FEFO keeps FIFO order when expiry dates are equal or absent", () => {
    const sameExpiryEarly = {
      id: "same-a",
      received_at: "2026-01-01T08:00:00.000Z",
      expiry_date: "2026-12-31",
    };
    const sameExpiryLate = {
      id: "same-b",
      received_at: "2026-05-01T08:00:00.000Z",
      expiry_date: "2026-12-31",
    };
    expect(ids(sortBatchesForIssue([sameExpiryLate, sameExpiryEarly], "fefo"))).toEqual([
      "same-a",
      "same-b",
    ]);

    const noExpiryA = { id: "noexp-a", received_at: "2026-01-01T08:00:00.000Z", expiry_date: null };
    const noExpiryB = { id: "noexp-b", received_at: "2026-02-01T08:00:00.000Z", expiry_date: null };
    expect(ids(sortBatchesForIssue([noExpiryB, noExpiryA], "fefo"))).toEqual([
      "noexp-a",
      "noexp-b",
    ]);
  });

  it("breaks ties by id so two batches received in the same millisecond stay deterministic", () => {
    const first = { id: "aaa", received_at: "2026-01-01T08:00:00.000Z", expiry_date: null };
    const second = { id: "bbb", received_at: "2026-01-01T08:00:00.000Z", expiry_date: null };
    expect(ids(sortBatchesForIssue([second, first], "fifo"))).toEqual(["aaa", "bbb"]);
    expect(ids(sortBatchesForIssue([first, second], "lifo"))).toEqual(["bbb", "aaa"]);
  });

  it("is a comparator and a non-mutating sort", () => {
    expect(compareBatchesForIssue(older, newer, "fifo")).toBeLessThan(0);
    expect(compareBatchesForIssue(older, newer, "lifo")).toBeGreaterThan(0);
    expect(compareBatchesForIssue(older, older, "fifo")).toBe(0);

    const input = [newer, older];
    const sorted = sortBatchesForIssue(input, "fifo");
    expect(ids(sorted)).toEqual([older.id, newer.id]);
    expect(ids(input)).toEqual([newer.id, older.id]);
  });
});
