import { describe, expect, it } from "vitest";
import { ageText, ghs, minutesToText, orderStatusBadge } from "../lib/adminClient.js";

describe("admin formatting helpers", () => {
  it("formats money and survives bad input", () => {
    expect(ghs(1234.5)).toBe("GHS 1,234.50");
    expect(ghs(undefined)).toBe("GHS 0.00");
    expect(ghs("abc")).toBe("GHS 0.00");
  });

  it("describes how long ago something happened", () => {
    const now = new Date("2026-09-30T12:00:00Z").getTime();
    expect(ageText("2026-09-30T11:59:40Z", now)).toBe("just now");
    expect(ageText("2026-09-30T11:30:00Z", now)).toBe("30 min");
    expect(ageText("2026-09-30T06:00:00Z", now)).toBe("6 h");
    expect(ageText("2026-09-25T12:00:00Z", now)).toBe("5 d");
    expect(ageText(null, now)).toBe("—");
    expect(minutesToText(45)).toBe("45 min");
    expect(minutesToText(3 * 24 * 60)).toBe("3 d");
    expect(minutesToText(null)).toBe("—");
  });

  it("gives every order one plain-language status", () => {
    expect(orderStatusBadge({ status: "success", fulfillmentStatus: "fulfilled" }).text).toBe("Delivered");
    expect(orderStatusBadge({ status: "payment_failed", failReason: "payment_abandoned" }).text).toBe("Abandoned");
    expect(orderStatusBadge({ status: "payment_failed", failReason: "declined" })).toEqual({ text: "Payment failed", tone: "red" });
    expect(orderStatusBadge({ status: "payment_verified", fulfillmentStatus: "manual_review" }).text).toBe("Needs review");
    expect(orderStatusBadge({ status: "payment_verified", fulfillmentStatus: "queued_with_provider" }).tone).toBe("amber");
    expect(orderStatusBadge({ status: "payment_verified", fulfillmentStatus: "ready" }).text).toBe("Paid — sending");
    expect(orderStatusBadge({ status: "pending", fulfillmentStatus: "pending" }).text).toBe("Awaiting payment");
    expect(orderStatusBadge(null).text).toBe("Unknown");
  });
});
