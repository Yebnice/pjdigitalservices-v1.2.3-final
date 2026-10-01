import { describe, expect, it } from "vitest";
import { getOrderStatusLabel } from "../lib/orderStatus";

describe("customer order status labels", () => {
  it("separates successful payment from fulfillment", () => {
    expect(getOrderStatusLabel({ status: "payment_verified", fulfillmentStatus: "ready" }))
      .toBe("Payment received — awaiting fulfillment");
    expect(getOrderStatusLabel({ status: "payment_verified", fulfillmentStatus: "processing" }))
      .toBe("Payment received — processing");
    expect(getOrderStatusLabel({ status: "payment_verified", fulfillmentStatus: "manual_review" }))
      .toBe("Payment received — under review");
    expect(getOrderStatusLabel({ status: "payment_verified", fulfillmentStatus: "failed" }))
      .toBe("Payment received — fulfillment failed");
  });

  it("keeps queued and completed orders distinct", () => {
    expect(getOrderStatusLabel({ status: "payment_verified", fulfillmentStatus: "queued_with_provider" }))
      .toBe("Queued for delivery");
    expect(getOrderStatusLabel({ status: "success", fulfillmentStatus: "fulfilled", fulfilled: true }))
      .toBe("Delivered");
  });

  it("does not call an unpaid order a payment failure", () => {
    expect(getOrderStatusLabel({ status: "pending", fulfillmentStatus: "pending" }))
      .toBe("Payment pending");
    expect(getOrderStatusLabel({ status: "failed", fulfillmentStatus: "pending" }))
      .toBe("Payment failed");
  });

  // Regression: "payment_failed" fell through to "Processing", so a customer
  // Paystack had charged (amount/currency mismatch) was told nothing useful.
  it("never tells a charged-but-rejected customer their order is just 'Processing'", () => {
    expect(getOrderStatusLabel({ status: "payment_failed", failReason: "amount_mismatch" })).toBe("Payment received — under review");
    expect(getOrderStatusLabel({ status: "payment_failed", failReason: "currency_mismatch" })).toBe("Payment received — under review");
    expect(getOrderStatusLabel({ status: "payment_failed", failReason: "declined" })).toBe("Payment failed");
    expect(getOrderStatusLabel({ status: "payment_failed", failReason: "payment_abandoned" })).toBe("Payment cancelled");
  });

  it("labels an order an admin closed without delivery", () => {
    expect(getOrderStatusLabel({ status: "payment_verified", fulfillmentStatus: "resolved" })).toBe("Closed by support");
  });
});
