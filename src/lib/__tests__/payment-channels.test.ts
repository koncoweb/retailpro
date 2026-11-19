import { describe, expect, it } from "vitest";
import {
  computeMerchantFee,
  defaultChannels,
  enabledChannels,
  feeLabel,
  normalizeChannels,
  normalizeFee,
  paymentMethodForChannel,
} from "../payment-channels";

describe("normalizeChannels", () => {
  it("returns the three built-ins, in order, when nothing is stored", () => {
    expect(normalizeChannels(null).map((c) => c.id)).toEqual(["cash", "transfer", "qris"]);
    expect(normalizeChannels(undefined).every((c) => c.enabled)).toBe(true);
    expect(normalizeChannels("garbage").map((c) => c.id)).toEqual(["cash", "transfer", "qris"]);
    expect(normalizeChannels([]).map((c) => c.id)).toEqual(["cash", "transfer", "qris"]);
  });

  it("accepts both a bare array and a {channels} document", () => {
    const asArray = [{ id: "qris", enabled: false }];
    const asDoc = { channels: asArray };
    expect(normalizeChannels(asArray).find((c) => c.id === "qris")?.enabled).toBe(false);
    expect(normalizeChannels(asDoc).find((c) => c.id === "qris")?.enabled).toBe(false);
  });

  it("keeps built-ins present even if the stored document omitted them", () => {
    const result = normalizeChannels({ channels: [{ id: "qris", fee: { type: "percent", value: 0.7 } }] });
    expect(result.map((c) => c.id)).toEqual(["cash", "transfer", "qris"]);
    expect(result.find((c) => c.id === "qris")?.fee).toEqual({ type: "percent", value: 0.7 });
  });

  it("never lets cash be disabled into a channel with no label, and drops stray cash fees", () => {
    const result = normalizeChannels({ channels: [{ id: "cash", fee: { type: "flat", value: 500 } }] });
    expect(result.find((c) => c.id === "cash")?.fee).toBeUndefined();
  });

  it("coerces a non-boolean enabled to on unless it is exactly false", () => {
    expect(normalizeChannels({ channels: [{ id: "qris", enabled: 0 }] })[2].enabled).toBe(true);
    expect(normalizeChannels({ channels: [{ id: "qris", enabled: false }] })[2].enabled).toBe(false);
  });

  it("enabledChannels hides the disabled ones", () => {
    const on = enabledChannels({ channels: [{ id: "transfer", enabled: false }] });
    expect(on.map((c) => c.id)).toEqual(["cash", "qris"]);
  });
});

describe("normalizeFee", () => {
  it("drops zero, negative, and malformed fees", () => {
    expect(normalizeFee(undefined)).toBeUndefined();
    expect(normalizeFee({ type: "flat", value: 0 })).toBeUndefined();
    expect(normalizeFee({ type: "flat", value: -5 })).toBeUndefined();
    expect(normalizeFee({ type: "percent", value: 0 })).toBeUndefined();
    expect(normalizeFee({ type: "unknown", value: 3 })).toBeUndefined();
  });

  it("rounds flat values and clamps percent to 0..100", () => {
    expect(normalizeFee({ type: "flat", value: 2500.6 })).toEqual({ type: "flat", value: 2501 });
    expect(normalizeFee({ type: "percent", value: 140 })).toEqual({ type: "percent", value: 100 });
  });
});

describe("computeMerchantFee", () => {
  const qris = defaultChannels().find((c) => c.id === "qris")!;

  it("is zero for cash, no fee, or a non-positive total", () => {
    expect(computeMerchantFee({ id: "cash", label: "Tunai", enabled: true }, 100000)).toBe(0);
    expect(computeMerchantFee(qris, 100000)).toBe(0);
    expect(computeMerchantFee({ ...qris, fee: { type: "percent", value: 0.7 } }, 0)).toBe(0);
  });

  it("computes a percentage and rounds to whole rupiah", () => {
    const fee = { ...qris, fee: { type: "percent", value: 0.7 } as const };
    expect(computeMerchantFee(fee, 100000)).toBe(700);
    // 0.7% of 10.500 = 73.5 -> rounds to 74 (IDR has no cents).
    expect(computeMerchantFee(fee, 10_500)).toBe(74);
  });

  it("uses a flat fee verbatim regardless of total", () => {
    const fee = { ...qris, fee: { type: "flat", value: 2500 } as const };
    expect(computeMerchantFee(fee, 10_000)).toBe(2500);
    expect(computeMerchantFee(fee, 100_000)).toBe(2500);
  });
});

describe("feeLabel + paymentMethodForChannel", () => {
  it("describes flat and percent fees, and null when free", () => {
    expect(feeLabel({ id: "qris", label: "QRIS", enabled: true })).toBeNull();
    expect(feeLabel({ id: "qris", label: "QRIS", enabled: true, fee: { type: "percent", value: 0.7 } })).toBe("QRIS · 0.7%");
    expect(feeLabel({ id: "transfer", label: "Transfer Bank", enabled: true, fee: { type: "flat", value: 2500 } })).toContain("2.500");
  });

  it("maps channels to the stored payment_method and passes unknown ids through", () => {
    expect(paymentMethodForChannel("cash")).toBe("cash");
    expect(paymentMethodForChannel("transfer")).toBe("transfer");
    expect(paymentMethodForChannel("qris")).toBe("qris");
    expect(paymentMethodForChannel("ewallet")).toBe("ewallet");
  });
});
