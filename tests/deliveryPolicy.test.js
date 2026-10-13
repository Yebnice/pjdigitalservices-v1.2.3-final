import { describe, expect, it } from "vitest";
import { evaluateIntake, evaluateDelivery, autoDeliveryMaxAgeMinutes, retryMaxVerifiedHours, normaliseDeliveryMode } from "../lib/deliveryPolicy.js";
import { generateOrderNo, looksLikeOrderNo } from "../lib/orderNo.js";

const NOW = Date.parse("2026-10-01T22:30:00Z");
const minsAgo = (m) => new Date(NOW - m * 60000).toISOString();
const paid = (over = {}) => ({ createdAt: minsAgo(5), paymentVerifiedAt: minsAgo(4), paymentAmount: 206, checkoutAmount: 2.06, amount: 2, ...over });

describe("delivery policy: who may spend wallet money", () => {
  it("a fresh, recorded, live payment may be delivered automatically", () => {
    expect(evaluateDelivery({ order: paid(), now: NOW }).allowed).toBe(true);
  });
  it("manual mode holds EVERYTHING that has no admin approval", () => {
    const r = evaluateDelivery({ order: paid(), mode: "manual", now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("manual_mode");
  });
  it("a valid payment discovered late is still accepted for automatic fulfillment", () => {
    const r = evaluateIntake({ order: paid({ createdAt: minsAgo(300) }), now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.code).toBe("automatic");
  });
  it("but a paid order is NOT stranded at delivery time because the scheduler ran an hour late", () => {
    expect(evaluateDelivery({ order: paid({ createdAt: minsAgo(70), paymentVerifiedAt: minsAgo(67) }), now: NOW }).allowed).toBe(true);
  });
  it("a valid payment verified many hours ago is not stranded by a retry-age cutoff", () => {
    const r = evaluateDelivery({ order: paid({ createdAt: minsAgo(900), paymentVerifiedAt: minsAgo(800) }), now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.code).toBe("automatic");
  });
  it("legacy age-limit settings do not block valid paid orders", () => {
    expect(autoDeliveryMaxAgeMinutes({})).toBe(45); // retained for configuration compatibility
    expect(autoDeliveryMaxAgeMinutes({ AUTO_DELIVERY_MAX_AGE_MINUTES: "10" })).toBe(10);
    expect(evaluateIntake({ order: paid({ createdAt: minsAgo(300) }), now: NOW, env: { AUTO_DELIVERY_MAX_AGE_MINUTES: "10" } }).allowed).toBe(true);
  });
  it("no recorded payment = no delivery (an unpaid order can never be sent)", () => {
    expect(evaluateDelivery({ order: paid({ paymentVerifiedAt: null }), now: NOW }).code).toBe("no_payment_record");
    expect(evaluateDelivery({ order: paid({ paymentAmount: null }), now: NOW }).code).toBe("no_payment_record");
  });
  it("a recorded payment below the order total is not enough", () => {
    expect(evaluateDelivery({ order: paid({ paymentAmount: 100 }), now: NOW }).code).toBe("amount_short");
  });
  it("an explicit admin approval may override MANUAL mode only after payment evidence and amount checks", () => {
    const r = evaluateDelivery({ order: paid({ createdAt: minsAgo(900), paymentVerifiedAt: minsAgo(800) }), mode: "manual", approvedBy: "jonathan", now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.code).toBe("approved");
  });
  it("admin approval cannot bypass a missing Paystack payment record", () => {
    const r = evaluateDelivery({ order: paid({ paymentVerifiedAt: null }), mode: "manual", approvedBy: "jonathan" });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("no_payment_record");
  });
  it("admin approval cannot bypass an underpayment", () => {
    const r = evaluateDelivery({ order: paid({ paymentAmount: 100 }), mode: "manual", approvedBy: "jonathan" });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("amount_short");
  });
  it("automatic delivery remains blocked in MANUAL mode without explicit approval", () => {
    const r = evaluateDelivery({ order: paid(), mode: "manual" });
    expect(r.allowed).toBe(false);
    expect(r.code).toBe("manual_mode");
  });
  it("an unknown order is never allowed", () => {
    expect(evaluateDelivery({ order: null }).allowed).toBe(false);
  });
  it("legacy retry-age settings do not block valid paid orders", () => {
    expect(retryMaxVerifiedHours({})).toBe(6); // retained for configuration compatibility
    expect(retryMaxVerifiedHours({ AUTO_RETRY_MAX_VERIFIED_HOURS: "2" })).toBe(2);
    expect(evaluateDelivery({ order: paid({ paymentVerifiedAt: minsAgo(800) }), now: NOW, env: { AUTO_RETRY_MAX_VERIFIED_HOURS: "2" } }).allowed).toBe(true);
  });
  it("only automatic and manual are valid modes", () => {
    expect(normaliseDeliveryMode("Manual")).toBe("manual");
    expect(normaliseDeliveryMode("auto")).toBeNull();
  });
});

describe("own order numbers", () => {
  it("are PJ- plus 8 unambiguous characters and do not repeat", () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i += 1) {
      const n = generateOrderNo();
      expect(looksLikeOrderNo(n)).toBe(true);
      expect(/[01OIL]/.test(n.slice(3))).toBe(false);
      seen.add(n);
    }
    expect(seen.size).toBe(5000);
  });
  it("recognises backfilled legacy numbers but not Paystack references", () => {
    expect(looksLikeOrderNo("PJ-L0000042")).toBe(true);
    expect(looksLikeOrderNo("TLMABC123DEF456")).toBe(false);
  });
});
