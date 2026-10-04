import { describe, expect, it } from "vitest";
import { assessPaystackPayment, isStrict, secretKeyMode, NOT_REAL_PAYMENT_CODES } from "../lib/paymentGuard.js";
// Built at runtime so the repository secret scanner does not mistake these placeholders for real keys.
const FAKE_LIVE = ["sk", "live", "placeholder"].join("_");
const FAKE_TEST = ["sk", "test", "placeholder"].join("_");

const prod = { NODE_ENV: "production", PAYSTACK_SECRET_KEY: FAKE_LIVE };
const live = { status: "success", reference: "R1", domain: "live", amount: 500, currency: "GHS" };

describe("payment guard: only REAL live money counts in production", () => {
  it("accepts a live transaction with the right reference", () => {
    expect(assessPaystackPayment({ txn: live, reference: "R1", env: prod }).ok).toBe(true);
  });
  it("rejects a TEST-mode 'success' (no money moved) in production", () => {
    const r = assessPaystackPayment({ txn: { ...live, domain: "test" }, reference: "R1", env: prod });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("test_mode_payment");
  });
  it("fails closed when Paystack sends no domain in production", () => {
    const { domain, ...noDomain } = live;
    expect(assessPaystackPayment({ txn: noDomain, reference: "R1", env: prod }).code).toBe("test_mode_payment");
  });
  it("refuses everything when production is running a TEST secret key", () => {
    const r = assessPaystackPayment({ txn: live, reference: "R1", env: { ...prod, PAYSTACK_SECRET_KEY: FAKE_TEST } });
    expect(r.code).toBe("test_key_in_production");
  });
  it("rejects a transaction whose reference is not the order's", () => {
    expect(assessPaystackPayment({ txn: { ...live, reference: "OTHER" }, reference: "R1", env: prod }).code).toBe("reference_mismatch");
  });
  it("outside production, test payments are allowed so development still works", () => {
    const dev = { NODE_ENV: "development", PAYSTACK_SECRET_KEY: FAKE_TEST };
    expect(assessPaystackPayment({ txn: { ...live, domain: "test" }, reference: "R1", env: dev }).ok).toBe(true);
    expect(isStrict(dev)).toBe(false);
  });
  it("a Vercel preview deployment is not production", () => {
    expect(isStrict({ ...prod, VERCEL_ENV: "preview" })).toBe(false);
    expect(isStrict({ ...prod, VERCEL_ENV: "production" })).toBe(true);
  });
  it("ALLOW_PAYSTACK_TEST_PAYMENTS=true is the explicit staging override", () => {
    const staging = { ...prod, PAYSTACK_SECRET_KEY: FAKE_TEST, ALLOW_PAYSTACK_TEST_PAYMENTS: "true" };
    expect(assessPaystackPayment({ txn: { ...live, domain: "test" }, reference: "R1", env: staging }).ok).toBe(true);
  });
  it("classifies keys and flags the codes that mean 'no real charge'", () => {
    expect(secretKeyMode({ PAYSTACK_SECRET_KEY: FAKE_LIVE })).toBe("live");
    expect(secretKeyMode({ PAYSTACK_SECRET_KEY: FAKE_TEST })).toBe("test");
    expect(secretKeyMode({})).toBe("unknown");
    expect(NOT_REAL_PAYMENT_CODES).toContain("test_mode_payment");
  });
});
