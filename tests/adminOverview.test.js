import { describe, expect, it } from "vitest";
import { computeOverview, estimatedNetProfit, rangeStart } from "../lib/adminOverview.js";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const FEE = 0.0195;

function order(over = {}) {
  return {
    reference: "R" + Math.random().toString(36).slice(2, 8),
    orderType: "ecg", network: "ecg", status: "success", fulfilled: true, fulfillmentStatus: "fulfilled",
    amount: 100, providerCost: 100, customerProductAmount: 102, businessMarkupAmount: 2,
    checkoutAmount: 102, paymentAmount: 10403, paystackFeeActual: 2.03, paystackNetSettled: 102, paystackFeeAmount: null, failReason: null,
    createdAt: "2026-09-30T08:00:00.000Z", ...over,
  };
}

describe("estimatedNetProfit", () => {
  it("uses the actual Paystack net settlement in customer-fee pass-through mode", () => {
    // Customer pays 104.03 including Paystack's fee; Paystack settles exactly
    // the 102.00 service amount to us; Techlink cost is 100.00.
    expect(estimatedNetProfit(order(), FEE)).toBe(2);
  });

  it("falls back to actual fee minus charge when net settlement was not stored", () => {
    const legacyEvidence = order({ paystackNetSettled: null, paystackFeeActual: 2.03, paymentAmount: 10403 });
    expect(estimatedNetProfit(legacyEvidence, FEE)).toBe(2);
  });
});

describe("computeOverview", () => {
  it("counts money on delivered orders only", () => {
    const o = computeOverview([order(), order({ status: "payment_verified", fulfilled: false, fulfillmentStatus: "ready" })], { range: "7d", now: NOW, feeRate: FEE });
    expect(o.counts.delivered).toBe(1);
    expect(o.money.productSales).toBe(102);
    expect(o.money.businessMargin).toBe(2);
    expect(o.money.customerPayments).toBe(104.03);
  });

  it("respects the date range", () => {
    const old = order({ createdAt: "2026-08-01T10:00:00.000Z" });
    expect(computeOverview([order(), old], { range: "today", now: NOW, feeRate: FEE }).counts.delivered).toBe(1);
    expect(computeOverview([order(), old], { range: "all", now: NOW, feeRate: FEE }).counts.delivered).toBe(2);
    expect(rangeStart("today", NOW).toISOString()).toBe("2026-09-30T00:00:00.000Z");
    expect(rangeStart("7d", NOW).toISOString()).toBe("2026-09-24T00:00:00.000Z");
    expect(rangeStart("all", NOW)).toBeNull();
  });

  it("does not let abandoned checkouts drag payment success down", () => {
    const orders = [order(), order(), order({ status: "payment_failed", fulfilled: false, fulfillmentStatus: "pending", failReason: "payment_abandoned" }), order({ status: "payment_failed", fulfilled: false, fulfillmentStatus: "pending", failReason: "declined" })];
    const o = computeOverview(orders, { range: "7d", now: NOW, feeRate: FEE });
    expect(o.counts.abandoned).toBe(1);
    expect(o.counts.paymentFailed).toBe(1);
    expect(o.rates.payment).toBe(67); // 2 paid of 3 real attempts
  });

  it("reports money at risk (paid but not delivered) regardless of age", () => {
    const stuck = order({ status: "payment_verified", fulfilled: false, fulfillmentStatus: "manual_review", checkoutAmount: 50, createdAt: "2026-09-30T10:00:00.000Z" });
    const stuckOld = order({ status: "payment_verified", fulfilled: false, fulfillmentStatus: "failed", checkoutAmount: 25, createdAt: "2026-09-01T10:00:00.000Z" });
    const o = computeOverview([], { range: "today", now: NOW, atRiskOrders: [stuck, stuckOld], feeRate: FEE });
    expect(o.atRisk.count).toBe(2);
    expect(o.atRisk.value).toBe(75);
    expect(o.atRisk.oldestMinutes).toBe(29 * 24 * 60 + 2 * 60);
  });

  it("builds one trend bucket per day and lists products by sales with their profit", () => {
    const o = computeOverview([order(), order({ createdAt: "2026-09-29T09:00:00.000Z" }), order({ orderType: "tv", network: "tv", customerProductAmount: 50, providerCost: 49, checkoutAmount: 51 })], { range: "7d", now: NOW, feeRate: FEE });
    expect(o.trend).toHaveLength(7);
    expect(o.trend[6].key).toBe("2026-09-30");
    expect(o.trend[6].orders).toBe(2);
    expect(o.trend[5].orders).toBe(1);
    expect(o.products[0].label).toBe("ecg");
    expect(o.products[0].orders).toBe(2);
  });

  it("handles an empty range without dividing by zero", () => {
    const o = computeOverview([], { range: "7d", now: NOW, feeRate: FEE });
    expect(o.money.avgOrderValue).toBe(0);
    expect(o.rates.payment).toBeNull();
    expect(o.rates.fulfillment).toBeNull();
  });

  it("falls back to 7 days for an unknown range", () => {
    expect(computeOverview([], { range: "forever", now: NOW }).range).toBe("7d");
  });

  it("does not count an order an admin closed without delivery as a failed delivery", () => {
    const resolved = order({ status: "payment_verified", fulfilled: false, fulfillmentStatus: "resolved" });
    const o = computeOverview([order(), resolved], { range: "7d", now: NOW, feeRate: FEE });
    expect(o.counts.delivered).toBe(1);
    expect(o.rates.fulfillment).toBe(100);
  });
});
