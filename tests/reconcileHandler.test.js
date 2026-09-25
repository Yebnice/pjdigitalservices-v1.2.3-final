import { describe, expect, it, vi, beforeEach } from "vitest";

// BUG FIX regression: /api/admin/reconcile.js used to discard the return
// value of requireAdminRole() (`if (!requireAdminRole(...)) return;`) and
// never destructured `generateAiSummary` out of the request body, while
// still referencing `actor.username` and `generateAiSummary` later in the
// handler. Both are undeclared/undefined in that scenario, so EVERY call
// to this endpoint threw a ReferenceError and returned 500 — the whole
// reconciliation feature was dead. These tests exercise the real handler
// (mocking only its external dependencies) to pin the fix in place.

vi.mock("../lib/adminAuth.js", () => ({
  requireAdminRole: vi.fn(() => ({ username: "test-operator", role: "operator" })),
}));

vi.mock("../lib/auditLog.js", () => ({
  recordAuditEvent: vi.fn(async () => {}),
}));

vi.mock("../lib/store.js", () => ({
  listOrders: vi.fn(async () => [
    { reference: "ORD-1", status: "success", checkoutAmount: 101.99, amount: 100, orderType: "ecg" },
    { reference: "ORD-2", status: "success", checkoutAmount: 51.0, amount: 50, orderType: "water" },
  ]),
}));

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

describe("POST /api/admin/reconcile (crash regression)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("does not crash and returns 200 for a normal CSV, without requesting an AI summary", async () => {
    const { default: handler } = await import("../pages/api/admin/reconcile.js");
    const { recordAuditEvent } = await import("../lib/auditLog.js");

    const csv = "Reference,Amount,Status\nORD-1,101.99,success\nORD-2,51.00,success\n";
    const req = { method: "POST", body: { csv } };
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.counts.matched).toBe(2);
    expect(res.body.counts.mismatched).toBe(0);
    expect(res.body.summary).toBeNull();
    // The audit event must use the real actor from requireAdminRole(),
    // not an undefined variable.
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actor: "test-operator", action: "reconciliation_run" })
    );
  });

  it("does not crash when generateAiSummary is omitted from the request body", async () => {
    const { default: handler } = await import("../pages/api/admin/reconcile.js");
    const csv = "Reference,Amount,Status\nORD-1,101.99,success\n";
    const req = { method: "POST", body: { csv } }; // no generateAiSummary key at all
    const res = makeRes();

    await handler(req, res); // used to throw ReferenceError: generateAiSummary is not defined
    expect(res.statusCode).toBe(200);
  });

  it("does not flag a match as mismatched when the CSV has no Status column", async () => {
    // Regression for the statusOk logic fix: a CSV with no recognizable
    // Status column (p.status === null for every row) must not be treated
    // the same as an explicit "reversed" row.
    const { default: handler } = await import("../pages/api/admin/reconcile.js");
    const csv = "Reference,Amount\nORD-1,101.99\nORD-2,51.00\n"; // no Status column at all
    const req = { method: "POST", body: { csv } };
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.counts.matched).toBe(2);
    expect(res.body.counts.mismatched).toBe(0);
  });

  it("still reports a genuinely reversed Paystack row as mismatched against a successful order", async () => {
    const { default: handler } = await import("../pages/api/admin/reconcile.js");
    const csv = "Reference,Amount,Status\nORD-1,101.99,reversed\n";
    const req = { method: "POST", body: { csv } };
    const res = makeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.counts.mismatched).toBe(1);
    expect(res.body.mismatched[0].reference).toBe("ORD-1");
  });
});
