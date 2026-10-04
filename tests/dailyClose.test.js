import { describe, expect, it } from "vitest";
import { computeOverview } from "../lib/adminOverview.js";
import { isAbandonedOrder } from "../lib/orderStatus.js";
import { csvCell, toCsv } from "../lib/csv.js";

const NOW = new Date("2026-10-05T12:00:00Z");
const day = (d, h = 10) => `2026-10-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00Z`;
const delivered = (ref, createdAt, over = {}) => ({ reference: ref, createdAt, status: "success", fulfilled: true, fulfillmentStatus: "fulfilled", orderType: "airtime", network: "mtn", amount: 10, providerCost: 10.2, customerProductAmount: 10, businessMarkupAmount: 0, checkoutAmount: 10.3, paystackFeeAmount: 0.3, ...over });

describe("daily close figures", () => {
  const orders = [delivered("A", day(4)), delivered("B", day(4, 15), { amount: 20, providerCost: 20.4, customerProductAmount: 20, checkoutAmount: 20.6, paystackFeeAmount: 0.6 }), delivered("C", day(5), { orderType: "data", businessMarkupAmount: 0.09, customerProductAmount: 4.49, providerCost: 4.4, checkoutAmount: 4.59, paystackFeeAmount: 0.1 })];
  const o = computeOverview(orders, { range: "7d", now: NOW });
  it("each day carries orders, sales, margin, payments, fees, cost and profit", () => {
    const d4 = o.trend.find((t) => t.key === "2026-10-04");
    expect(d4.orders).toBe(2);
    expect(d4.sales).toBe(30);
    expect(d4.payments).toBe(30.9);
    expect(d4.fees).toBe(0.9);
    expect(d4.cost).toBe(30.6);
    expect(typeof d4.profit).toBe("number");
    expect(typeof d4.margin).toBe("number");
  });
  it("the days add up to the headline totals (no money appears or vanishes)", () => {
    const sum = (k) => Math.round(o.trend.reduce((s, t) => s + t[k], 0) * 100) / 100;
    expect(sum("sales")).toBe(o.money.productSales);
    expect(sum("payments")).toBe(o.money.customerPayments);
    expect(sum("cost")).toBe(o.money.providerCost);
    expect(sum("profit")).toBeCloseTo(o.money.netProfit, 1);
    expect(sum("orders")).toBe(o.counts.delivered);
  });
});

describe("abandoned checkouts, old and new code", () => {
  it("both reason codes mean abandoned", () => {
    expect(isAbandonedOrder({ failReason: "payment_abandoned" })).toBe(true);
    expect(isAbandonedOrder({ failReason: "abandoned" })).toBe(true);
    expect(isAbandonedOrder({ failReason: "amount_mismatch" })).toBe(false);
    expect(isAbandonedOrder(null)).toBe(false);
  });
  it("a checkout closed under the OLD code is not counted as a payment failure", () => {
    const base = { createdAt: day(5), status: "payment_failed", fulfillmentStatus: "pending", orderType: "airtime", amount: 10 };
    const o = computeOverview([{ ...base, reference: "X1", failReason: "abandoned" }, { ...base, reference: "X2", failReason: "payment_abandoned" }, { ...base, reference: "X3", failReason: "amount_mismatch" }], { range: "7d", now: NOW });
    expect(o.counts.abandoned).toBe(2);
    expect(o.counts.paymentFailed).toBe(1);
  });
});

describe("csv export", () => {
  it("neutralises spreadsheet formulas but leaves plain negative numbers alone", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+233240000000")).toBe("'+233240000000");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-12.50")).toBe("-12.50");
  });
  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe("\"a,b\"");
    expect(csvCell("say \"hi\"")).toBe("\"say \"\"hi\"\"\"");
    expect(csvCell("two\nlines")).toBe("\"two\nlines\"");
    expect(csvCell(null)).toBe("");
  });
  it("builds a header and rows", () => {
    expect(toCsv([{ key: "a", label: "A" }, { label: "B", value: (r) => r.b * 2 }], [{ a: 1, b: 2 }])).toBe("A,B\r\n1,4");
  });
});
