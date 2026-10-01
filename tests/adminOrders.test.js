import { describe, expect, it } from "vitest";
import { ORDER_FILTERS, attentionCategory, attentionCounts, fetchAllRows, normalizePageParams, parseIsoDate, sanitizeSearchTerm, toAdminOrder } from "../lib/adminOrders.js";

describe("toAdminOrder", () => {
  const order = {
    reference: "ORD-1",
    orderType: "checker",
    phone: "0241234567",
    idempotencyKey: "secret-key",
    afaDetails: { fullName: "Ama Mensah", ghanaCard: "GHA-123456789-0", dob: "1990-01-01" },
    checkerDetails: { mode: "voucher", deliveryMethod: "sms" },
    result: { orderId: "T-9", message: "ok", status: "success", checkers: [{ serialNumber: "0123456789", pin: "987654321012" }], token: "1234-5678-9012" },
  };

  it("removes voucher PINs, serials and electricity tokens from the provider result", () => {
    const out = toAdminOrder(order);
    expect(out.result).toEqual({ orderId: "T-9", message: "ok", status: "success" });
    expect(JSON.stringify(out)).not.toContain("987654321012");
    expect(JSON.stringify(out)).not.toContain("1234-5678-9012");
  });

  it("removes the Ghana Card number and date of birth but keeps enough to identify the order", () => {
    const out = toAdminOrder(order);
    expect(JSON.stringify(out)).not.toContain("GHA-123456789-0");
    expect(JSON.stringify(out)).not.toContain("1990-01-01");
    expect(out.hasAfaDetails).toBe(true);
    expect(out.afaName).toBe("Ama Mensah");
    expect(out.afaDetails).toBeUndefined();
  });

  it("drops the idempotency key and keeps normal fields", () => {
    const out = toAdminOrder(order);
    expect(out.idempotencyKey).toBeUndefined();
    expect(out.reference).toBe("ORD-1");
    expect(out.phone).toBe("0241234567");
  });

  it("handles orders with no result at all", () => {
    expect(toAdminOrder({ reference: "X" }).result).toBeNull();
    expect(toAdminOrder(null)).toBeNull();
  });
});

describe("order search and paging inputs", () => {
  it("strips characters that could change the meaning of a PostgREST or() filter", () => {
    const evil = "x%,reference.neq.zzz),(email.ilike.*";
    const clean = sanitizeSearchTerm(evil);
    for (const ch of [",", "(", ")", "%", "*"]) expect(clean.includes(ch)).toBe(false);
  });

  it("keeps everything a reference, phone or email needs", () => {
    expect(sanitizeSearchTerm("  ORD-7K2M9X4P ")).toBe("ORD-7K2M9X4P");
    expect(sanitizeSearchTerm("+233 24 123 4567")).toBe("+233 24 123 4567");
    expect(sanitizeSearchTerm("kofi.mensah@example.com")).toBe("kofi.mensah@example.com");
  });

  it("caps the search length", () => {
    expect(sanitizeSearchTerm("a".repeat(500)).length).toBe(64);
  });

  it("clamps page and page size", () => {
    expect(normalizePageParams({})).toEqual({ page: 1, pageSize: 25, from: 0, to: 24 });
    expect(normalizePageParams({ page: "3", pageSize: "10" })).toEqual({ page: 3, pageSize: 10, from: 20, to: 29 });
    expect(normalizePageParams({ page: "-4", pageSize: "100000" }).pageSize).toBe(100);
    expect(normalizePageParams({ page: "abc", pageSize: "1" }).pageSize).toBe(5);
  });

  it("parses dates safely", () => {
    expect(parseIsoDate("2026-09-01")).toBe("2026-09-01T00:00:00.000Z");
    expect(parseIsoDate("not a date")).toBeNull();
    expect(parseIsoDate("")).toBeNull();
  });

  it("defines every filter the dashboard offers, none needing its own OR clause", () => {
    for (const id of ["all", "attention", "paid_undelivered", "fulfilled", "failed_delivery", "payment_failed", "unpaid", "abandoned"]) {
      expect(Boolean(ORDER_FILTERS[id])).toBe(true);
    }
  });
});

// Regression: Supabase returns at most 1,000 rows per request WITHOUT an
// error, so "select everything" silently dropped every order past the
// newest 1,000 from the dashboard totals, the CSV export and reconciliation.
describe("fetchAllRows", () => {
  const table = (n) => Array.from({ length: n }, (_, i) => ({ id: i }));
  const pager = (rows, log = []) => async (from, to) => { log.push([from, to]); return { data: rows.slice(from, to + 1), error: null }; };

  it("walks every page instead of stopping at the first 1,000 rows", async () => {
    const log = [];
    const rows = await fetchAllRows(pager(table(2500), log));
    expect(rows.length).toBe(2500);
    expect(log).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("handles empty tables and exact page boundaries", async () => {
    expect((await fetchAllRows(pager(table(0)))).length).toBe(0);
    expect((await fetchAllRows(pager(table(1000)))).length).toBe(1000);
  });

  it("throws on a database error instead of returning a partial list", async () => {
    let threw = false;
    try { await fetchAllRows(async () => ({ data: null, error: { message: "boom" } })); } catch (err) { threw = err.message === "boom"; }
    expect(threw).toBe(true);
  });

  it("stops at the safety cap", async () => {
    const rows = await fetchAllRows(pager(table(5000)), 1000, 2000);
    expect(rows.length).toBe(2000);
  });
});

// Regression: the Orders tab showed "Customer paid GHS 510.00" for a GHS 5.10
// order. orders.payment_amount is Paystack's figure in PESEWAS.
describe("payment amount units", () => {
  it("converts Paystack pesewas to cedis once, on the server", () => {
    expect(toAdminOrder({ reference: "A", paymentAmount: 510 }).paymentAmountGhs).toBe(5.1);
    expect(toAdminOrder({ reference: "B", paymentAmount: 2237 }).paymentAmountGhs).toBe(22.37);
    expect(toAdminOrder({ reference: "C", paymentAmount: 10403 }).paymentAmountGhs).toBe(104.03);
    expect(toAdminOrder({ reference: "D" }).paymentAmountGhs).toBeNull();
  });
});

describe("needs-attention categories", () => {
  it("separates customers who were charged from unpaid checkouts and from paid orders", () => {
    expect(attentionCategory({ status: "payment_failed", failReason: "amount_mismatch" })).toBe("charged_rejected");
    expect(attentionCategory({ status: "payment_failed", failReason: "currency_mismatch" })).toBe("charged_rejected");
    expect(attentionCategory({ status: "pending" })).toBe("unpaid");
    expect(attentionCategory({ status: "payment_pending" })).toBe("unpaid");
    expect(attentionCategory({ status: "payment_verified", fulfillmentStatus: "ready" })).toBe("ready");
    expect(attentionCategory({ status: "payment_verified", fulfillmentStatus: "queued_with_provider" })).toBe("queued");
    expect(attentionCategory({ status: "payment_verified", fulfillmentStatus: "manual_review" })).toBe("retryable");
    expect(attentionCategory({ status: "payment_verified", fulfillmentStatus: "failed" })).toBe("retryable");
  });

  it("counts only paid orders toward 'need a decision', not abandoned checkouts", () => {
    const counts = attentionCounts([{ status: "pending" }, { status: "pending" }, { status: "payment_verified", fulfillmentStatus: "ready" }, { status: "payment_failed", failReason: "amount_mismatch" }]);
    expect(counts.unpaid).toBe(2);
    expect(counts.paidNeedingAction).toBe(2);
  });
});
