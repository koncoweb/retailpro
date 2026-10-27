import { describe, expect, it } from "vitest";
import {
  dueDateFromTerms,
  isOverdue,
  nextVendorCode,
  outstandingAmount,
  vendorCategoryLabel,
  vendorInitials,
  vendorPaymentMethodLabel,
  vendorStatusLabel,
} from "./vendor";

describe("nextVendorCode", () => {
  it("starts at VND-0001 when there is no code yet", () => {
    expect(nextVendorCode(null)).toBe("VND-0001");
    expect(nextVendorCode("")).toBe("VND-0001");
    expect(nextVendorCode("not-a-code")).toBe("VND-0001");
  });

  it("increments the sequence and keeps four digits", () => {
    expect(nextVendorCode("VND-0001")).toBe("VND-0002");
    expect(nextVendorCode("VND-0099")).toBe("VND-0100");
    expect(nextVendorCode("VND-9999")).toBe("VND-10000");
  });
});

describe("outstandingAmount", () => {
  it("returns the unpaid remainder", () => {
    expect(outstandingAmount(500_000, 200_000)).toBe(300_000);
  });

  it("never goes negative when overpaid or null", () => {
    expect(outstandingAmount(200_000, 500_000)).toBe(0);
    expect(outstandingAmount(0, 0)).toBe(0);
  });
});

describe("dueDateFromTerms", () => {
  const from = new Date("2026-03-01T08:00:00.000Z");

  it("adds the vendor term to the document date", () => {
    expect(dueDateFromTerms(30, from)).toBe("2026-03-31");
    expect(dueDateFromTerms(0, from)).toBe("2026-03-01");
  });

  it("treats missing or negative terms as cash on delivery", () => {
    expect(dueDateFromTerms(Number.NaN, from)).toBe("2026-03-01");
    expect(dueDateFromTerms(-10, from)).toBe("2026-03-01");
  });
});

describe("isOverdue", () => {
  it("is false when there is no due date or the bill is due today", () => {
    expect(isOverdue(null)).toBe(false);
    expect(isOverdue("2026-03-31", "2026-03-31")).toBe(false);
  });

  it("is true only once the due date has passed", () => {
    expect(isOverdue("2026-03-30", "2026-03-31")).toBe(true);
    expect(isOverdue("2026-03-30T10:00:00.000Z", "2026-03-31")).toBe(true);
  });
});

describe("labels", () => {
  it("maps known codes and falls back for unknown ones", () => {
    expect(vendorCategoryLabel("distributor")).toBe("Distributor");
    expect(vendorCategoryLabel("unknown")).toBe("Supplier");
    expect(vendorStatusLabel("blacklisted")).toBe("Blacklist");
    expect(vendorStatusLabel(null)).toBe("Aktif");
    expect(vendorPaymentMethodLabel("check")).toBe("Cek / Giro");
    expect(vendorPaymentMethodLabel(undefined)).toBe("Transfer Bank");
  });
});

describe("vendorInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(vendorInitials("CV Aroma Pangan Nusantara")).toBe("CA");
    expect(vendorInitials("Kemasan")).toBe("K");
  });

  it("ignores punctuation and extra whitespace", () => {
    expect(vendorInitials("  PT  Sumber-Terigu  ")).toBe("PS");
  });
});
