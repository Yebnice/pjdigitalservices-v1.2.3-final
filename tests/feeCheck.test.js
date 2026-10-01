import { describe, expect, it } from "vitest";
import { readPaystackFees, assessPaystackFee, describeFeeProblem } from "../lib/feeCheck.js";

// Order for a GHS 4.49 product: customer pays 4.59, expected fee 0.10.
const order = { customerProductAmount: 4.49, amount: 4.4, paystackFeeAmount: 0.1 };

describe("Paystack fee check", () => {
  it("reads fees from the verify response (pesewas) into GHS", () => {
    expect(readPaystackFees({ amount: 459, fees: 9 })).toEqual({ feeGhs: 0.09, netGhs: 4.5 });
  });

  it("returns null when Paystack sends no usable fee", () => {
    for (const t of [{}, { amount: 459 }, { amount: 459, fees: null }, { amount: 459, fees: "abc" }, { amount: 459, fees: -1 }, null]) {
      expect(readPaystackFees(t)).toBeNull();
    }
  });

  it("is ok when we settle at least the product price and the fee is within a pesewa", () => {
    expect(assessPaystackFee(order, { amount: 459, fees: 9 }).status).toBe("ok");
    expect(assessPaystackFee(order, { amount: 459, fees: 10 }).status).toBe("ok");
  });

  it("flags net_below_price when the fee eats into the product price", () => {
    const a = assessPaystackFee(order, { amount: 459, fees: 11 });
    expect(a.status).toBe("net_below_price");
    expect(a.shortfallGhs).toBe(0.01);
    expect(describeFeeProblem(a)).toContain("BELOW the product price");
  });

  it("flags fee_differs when the fee is off but the price is still covered", () => {
    const cheaper = { ...order, paystackFeeAmount: 0.3 };
    const a = assessPaystackFee(cheaper, { amount: 459, fees: 9 });
    expect(a.status).toBe("fee_differs");
  });

  it("reports unavailable instead of guessing when there is no fee figure", () => {
    expect(assessPaystackFee(order, { amount: 459 }).status).toBe("unavailable");
  });

  it("catches the airtime case where a doubled rate would cost money", () => {
    const airtime = { customerProductAmount: 100, amount: 100, paystackFeeAmount: 2.0 };
    expect(assessPaystackFee(airtime, { amount: 10200, fees: 400 }).status).toBe("net_below_price");
  });
});
