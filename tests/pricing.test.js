import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { businessMarkup, getOrderPricing, previewCustomerTotal, withPaystackFee } from "../lib/pricing.js";

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

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
    expect(pricing.checkoutAmount).toBeCloseTo(103.01, 2);
    expect(pricing.checkoutAmount).toBeGreaterThan(pricing.customerProductAmount);
  });

  // BUG FIX regression: AFA, ECG, Water, TV and the bulk-data Excel/CSV
  // fallback estimate used to preview the customer's total with
  // withPaystackFee(rawAmount) alone, which adds the Paystack fee but
  // silently skips the 1% business markup — understating the price shown
  // before checkout for every non-zero-margin order type. previewCustomerTotal
  // must match what getOrderPricing() (the real server-side charge) produces.
  it("previewCustomerTotal matches getOrderPricing's real checkout total for a marked-up service", () => {
    const preview = previewCustomerTotal(100, { orderType: "ecg" });
    const real = getOrderPricing({ providerCost: 100, customerBaseAmount: 100, orderType: "ecg" });
    expect(preview).toBeCloseTo(real.checkoutAmount, 2);
    // And it must be strictly more than the old, buggy calculation.
    expect(preview).toBeGreaterThan(withPaystackFee(100));
  });

  it("previewCustomerTotal equals withPaystackFee for genuinely zero-margin order types", () => {
    for (const orderType of ["airtime", "data", "tierbulkairtime"]) {
      expect(previewCustomerTotal(100, { orderType })).toBeCloseTo(withPaystackFee(100), 2);
    }
  });

  it("wires every customer-facing price preview through previewCustomerTotal, not withPaystackFee alone", () => {
    const checks = [
      { file: "pages/afa.js", mustContain: "previewCustomerTotal(fee, { orderType: \"afa\", network })" },
      { file: "pages/bills.js", mustContain: 'previewCustomerTotal(Number(amount), { orderType: "ecg" })' },
      { file: "pages/bills.js", mustContain: 'orderType: "water" }).toFixed(2)' },
      { file: "pages/tv.js", mustContain: 'previewCustomerTotal(Number(validation.balance' },
      { file: "pages/checker.js", mustContain: 'previewCustomerTotal(voucherPrice * quantity, { orderType: "checker" })' },
      { file: "pages/checker.js", mustContain: 'previewCustomerTotal(lookupPrice, { orderType: "checker" })' },
      { file: "components/TierShop.js", mustContain: "businessMarkup(b.price, { orderType: \"tierBulkData\", network: tier?.network })" },
    ];
    for (const { file, mustContain } of checks) {
      expect(read(file)).toContain(mustContain);
    }
  });
});
