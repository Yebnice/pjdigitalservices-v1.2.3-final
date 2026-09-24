import { describe, expect, it } from "vitest";
import { businessMarkup, getOrderPricing, withPaystackFee } from "../lib/pricing.js";

describe("pricing policy", () => {
  it("keeps Airtime and Quick Data at zero business margin", () => {
    expect(businessMarkup(100, { orderType: "airtime", network: "mtn" })).toBe(0);
    expect(businessMarkup(100, { orderType: "data", network: "mtn" })).toBe(0);
    expect(businessMarkup(100, { orderType: "tierBulkAirtime", network: "telecel" })).toBe(0);
  });

  it("applies the default 1% business margin to other services", () => {
    expect(businessMarkup(100, { orderType: "ecg", network: "ecg" })).toBe(1);
  });

  it("treats a fixed-only rule as an override, not fixed plus default percent", () => {
    const old = process.env.SERVICE_MARKUP_RULES_JSON;
    process.env.SERVICE_MARKUP_RULES_JSON = JSON.stringify({ water: { fixed: 1 } });
    try {
      expect(businessMarkup(100, { orderType: "water", network: "water" })).toBe(1);
    } finally {
      if (old === undefined) delete process.env.SERVICE_MARKUP_RULES_JSON;
      else process.env.SERVICE_MARKUP_RULES_JSON = old;
    }
  });

  it("computes the Paystack fee consistently from the gross checkout amount", () => {
    const total = withPaystackFee(100);
    expect(total).toBeCloseTo(101.99, 2);
    const pricing = getOrderPricing({
      providerCost: 100,
      customerBaseAmount: 100,
      orderType: "ecg",
      network: "ecg",
    });
    expect(pricing.customerProductAmount).toBe(101);
    expect(pricing.checkoutAmount).toBeCloseTo(102.0, 1);
    expect(pricing.checkoutAmount).toBeGreaterThan(pricing.customerProductAmount);
  });
});
