import { describe, expect, it } from "vitest";
import { withPaystackFee, previewBreakdown, getOrderPricing, PAYSTACK_FEE_RATE } from "../lib/pricing.js";

const round2 = (v) => Math.round(v * 100) / 100;

// We do not know whether Paystack rounds its fee to the nearest pesewa or up,
// so the guarantee must hold under both.
const feeNearest = (total) => round2(total * PAYSTACK_FEE_RATE);
const feeRoundedUp = (total) => Math.ceil(total * PAYSTACK_FEE_RATE * 100 - 1e-9) / 100;

describe("Paystack fee gross-up", () => {
  it("never settles below the product price, for every price from GHS 0.01 to 500.00", () => {
    const shortfalls = [];
    for (let pesewas = 1; pesewas <= 50000; pesewas += 1) {
      const price = pesewas / 100;
      const total = withPaystackFee(price);
      for (const [mode, feeFn] of [["nearest", feeNearest], ["up", feeRoundedUp]]) {
        const net = round2(total - feeFn(total));
        if (net < price - 1e-9) shortfalls.push({ price, total, mode, net });
      }
    }
    expect(shortfalls.slice(0, 5)).toEqual([]);
  });

  it("follows Paystack's documented formula (Price / (1 - fee) + 0.01)", () => {
    expect(withPaystackFee(100)).toBe(102.0);
    expect(withPaystackFee(4.49)).toBe(4.59);
  });

  it("keeps an empty or zero price at zero", () => {
    expect(withPaystackFee(0)).toBe(0);
    expect(withPaystackFee("")).toBe(0);
    expect(previewBreakdown(0, { orderType: "airtime" }).total).toBe(0);
  });

  it("previewBreakdown always satisfies price + fee = total and matches the server's amount", () => {
    for (const orderType of ["airtime", "data", "ecg", "tv", "water", "checker", "afa", "tierData", "tierBulkData"]) {
      for (const base of [1, 4.4, 9.99, 25, 100, 333.33]) {
        const b = previewBreakdown(base, { orderType, network: "mtn" });
        const server = getOrderPricing({ providerCost: base, customerBaseAmount: base, orderType, network: "mtn" });
        expect(round2(b.productAmount + b.feeAmount)).toBe(b.total);
        expect(b.total).toBe(server.checkoutAmount);
      }
    }
  });
});
