import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  businessMarkup,
  getOrderPricing,
  getPaystackPaymentAmount,
  previewCustomerTotal,
  withPaystackFee,
  PAYSTACK_PASS_FEES_TO_CUSTOMERS,
} from "../lib/pricing.js";

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("pricing policy", () => {
  it("keeps Airtime and Quick Data at zero business margin", () => {
    expect(businessMarkup(100, { orderType: "airtime", network: "mtn" })).toBe(0);
    expect(businessMarkup(100, { orderType: "data", network: "mtn" })).toBe(0);
    expect(businessMarkup(100, { orderType: "tierBulkAirtime", network: "telecel" })).toBe(0);
  });

  it("applies exactly 2% to every non-exempt service in the pricing matrix", () => {
    const twoPercentServices = [
      "afa", "ecg", "water", "tv", "checker", "tierData", "tierBulkData",
    ];
    for (const orderType of twoPercentServices) {
      expect(businessMarkup(100, { orderType })).toBe(2);
    }
  });

  it("cannot be changed by a deployment margin override", () => {
    const old = process.env.DEFAULT_BUSINESS_MARGIN_PERCENT;
    process.env.DEFAULT_BUSINESS_MARGIN_PERCENT = "1";
    try {
      expect(businessMarkup(100, { orderType: "ecg" })).toBe(2);
    } finally {
      if (old === undefined) delete process.env.DEFAULT_BUSINESS_MARGIN_PERCENT;
      else process.env.DEFAULT_BUSINESS_MARGIN_PERCENT = old;
    }
  });

  it("applies Techlink 2% and leaves Paystack's fee to Paystack", () => {
    const pricing = getOrderPricing({
      providerCost: 1.02,
      customerBaseAmount: 1,
      orderType: "airtime",
      network: "mtn",
    });
    expect(pricing.markupAmount).toBe(0);
    expect(pricing.customerProductAmount).toBe(1.02);
    expect(PAYSTACK_PASS_FEES_TO_CUSTOMERS).toBe(true);
    expect(pricing.checkoutAmount).toBe(1.02);
    expect(pricing.paystackFeeAmount).toBeNull();
    expect(pricing.paymentAmount).toBe(1.02);
  });

  it("applies Techlink 2% first for Quick Data and leaves Paystack's fee to Paystack", () => {
    const pricing = getOrderPricing({
      providerCost: 1.02,
      customerBaseAmount: 1,
      orderType: "data",
      network: "mtn",
    });
    expect(pricing.markupAmount).toBe(0);
    expect(pricing.customerProductAmount).toBe(1.02);
    expect(pricing.checkoutAmount).toBe(1.02);
    expect(pricing.paystackFeeAmount).toBeNull();
    expect(pricing.paymentAmount).toBe(1.02);
  });


  it("keeps idempotent/retry payment amounts aligned with the service amount", () => {
    expect(getPaystackPaymentAmount(1.02, 1.02, 1)).toBe(1.02);
    expect(getPaystackPaymentAmount(1.02, 1.05, 1)).toBe(1.02);
  });

  it("does not send the manually grossed-up amount to Paystack in pass-through mode", () => {
    const pricing = getOrderPricing({
      providerCost: 1.02,
      customerBaseAmount: 1,
      orderType: "airtime",
      network: "mtn",
    });
    expect(pricing.customerProductAmount).toBe(1.02);
    expect(pricing.checkoutAmount).toBe(1.02);
    expect(pricing.paymentAmount).toBe(1.02);
    expect(withPaystackFee(pricing.customerProductAmount)).toBe(1.05);
    expect(pricing.paymentAmount).not.toBe(withPaystackFee(pricing.customerProductAmount));
  });

  it("keeps the manual Paystack gross-up helper available for legacy mode", () => {
    // Paystack's formula: Price / (1 - 0.0195) + 0.01
    const total = withPaystackFee(100);
    expect(total).toBeCloseTo(102.0, 2);
    const pricing = getOrderPricing({
      providerCost: 100,
      customerBaseAmount: 100,
      orderType: "ecg",
      network: "ecg",
    });
    expect(pricing.customerProductAmount).toBe(102);
    expect(pricing.checkoutAmount).toBe(102);
    expect(pricing.paymentAmount).toBe(102);
  });

  // BUG FIX regression: AFA, ECG, Water, TV and the bulk-data Excel/CSV
  // fallback estimate used to preview the customer's total with
  // withPaystackFee(rawAmount) alone, which adds the Paystack fee but
  // silently skips the 2% business markup — understating the price shown
  // before checkout for every non-zero-margin order type. previewCustomerTotal
  // must match what getOrderPricing() (the real server-side charge) produces.
  it("previewCustomerTotal matches getOrderPricing's real checkout total for a marked-up service", () => {
    const preview = previewCustomerTotal(100, { orderType: "ecg" });
    const real = getOrderPricing({ providerCost: 100, customerBaseAmount: 100, orderType: "ecg" });
    expect(preview).toBeCloseTo(real.customerProductAmount, 2);
    expect(preview).toBe(102);
  });

  it("previewCustomerTotal includes Techlink 2% before Paystack on zero-margin order types", () => {
    for (const orderType of ["airtime", "data", "tierbulkairtime"]) {
      expect(previewCustomerTotal(100, { orderType })).toBe(102);
    }
  });

  it("wires the idempotent order response through the shared Paystack amount resolver", () => {
    expect(read("pages/api/orders/create.js")).toContain("getPaystackPaymentAmount(");
    expect(read("pages/api/orders/create.js")).toContain("existing.customerProductAmount");
    expect(read("pages/api/orders/create.js")).toContain("existing.checkoutAmount");
    expect(read("pages/api/orders/create.js")).toContain("order.customerProductAmount");
    expect(read("pages/api/orders/create.js")).toContain("order.checkoutAmount");
  });

  it("does not display a zero Paystack fee when the real fee is unavailable in pass-through mode", () => {
    const source = read("components/ui.js");
    expect(source).toContain("o.paystackFeeActual");
    expect(source).toContain("Paystack fee calculated at checkout");
    expect(source).not.toContain("Number(o.paystackFeeAmount ?? 0).toFixed(2)");
    expect(source).toContain("Number(o.paymentAmount ?? o.checkoutAmount ?? o.amount).toFixed(2)");
  });

  it("does not gross-up bulk order price guards when Paystack pass-through is enabled", () => {
    const source = read("components/TierShop.js");
    expect(source).toContain("expectedAmount: total > 0 ? total : undefined");
    expect(source).not.toContain("expectedAmount: total > 0 ? withPaystackFee(total) : undefined");
    expect(source).not.toContain("withPaystackFee");
    expect(source).toContain("Paystack calculates and adds the processing fee at checkout");
    expect(read("pages/afa.js")).not.toContain("(includes payment processing fee)");
    expect(read("pages/checker.js")).not.toContain("(incl. fees)");
    expect(read("pages/afa.js")).toContain("fee added at checkout");
    expect(read("pages/checker.js")).toContain("fee added at checkout");
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

// Regression: a failed airtime-fee lookup silently assumed a 0% Techlink fee,
// so the recorded cost was too low and airtime profit was overstated.
describe("Techlink airtime fee resolution", () => {
  it("reads either form of Techlink's fee response", async () => {
    const { resolveAirtimeFeeRate } = await import("../lib/pricing.js");
    expect(resolveAirtimeFeeRate({ percent: 2, rate: 0.02 })).toBe(0.02);
    expect(resolveAirtimeFeeRate({ percent: 2 })).toBe(0.02);
    expect(resolveAirtimeFeeRate({ rate: 0.03 })).toBe(0.03);
    expect(resolveAirtimeFeeRate({ rate: 0 })).toBe(0);
  });

  it("returns null for anything unusable instead of guessing zero", async () => {
    const { resolveAirtimeFeeRate } = await import("../lib/pricing.js");
    for (const bad of [{}, null, undefined, { percent: "abc" }, { rate: 5 }, { percent: -1 }]) expect(resolveAirtimeFeeRate(bad)).toBeNull();
  });

  it("keeps the Techlink customer fee at exactly 2%", async () => {
    const { DEFAULT_TECHLINK_FEE_RATE, DEFAULT_AIRTIME_PROVIDER_FEE_RATE } = await import("../lib/pricing.js");
    expect(DEFAULT_TECHLINK_FEE_RATE).toBe(0.02);
    expect(DEFAULT_AIRTIME_PROVIDER_FEE_RATE).toBe(0.02);
  });
});
