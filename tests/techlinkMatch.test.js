import { describe, expect, it } from "vitest";
import { assessTechlinkEvidence, classifyTechlinkStatus, retryIsSafe } from "../lib/techlinkMatch.js";

const order = (over = {}) => ({ reference: "R1", phone: "0241234567", providerCost: 2.04, amount: 2, createdAt: "2026-09-30T10:00:00Z", paymentVerifiedAt: "2026-09-30T10:01:00Z", ...over });
const row = (over = {}) => ({ orderId: "ORD-1", phoneNumber: "0241234567", amount: 2.04, costPrice: 2, status: "completed", createdAt: "2026-09-30T10:02:00Z", ...over });

describe("Techlink delivery evidence", () => {
  it("classifies provider statuses", () => {
    for (const s of ["completed", "SUCCESS", "Delivered"]) expect(classifyTechlinkStatus(s)).toBe("delivered");
    for (const s of ["failed", "cancelled", "refunded"]) expect(classifyTechlinkStatus(s)).toBe("failed");
    for (const s of ["processing", "pending", "queued"]) expect(classifyTechlinkStatus(s)).toBe("in_progress");
    expect(classifyTechlinkStatus("")).toBe("unknown");
  });

  it("finds a delivered order by recipient, amount and time", () => {
    const ev = assessTechlinkEvidence(order(), [row()], { exhausted: true });
    expect(ev.verdict).toBe("delivered");
    expect(retryIsSafe(ev)).toBe(false);
  });

  it("matches on the face-value cost price as well as the wallet amount", () => {
    expect(assessTechlinkEvidence(order(), [row({ amount: 99, costPrice: 2.04 })], { exhausted: true }).verdict).toBe("delivered");
  });

  it("prefers an exact Techlink order id when we already hold one", () => {
    const ev = assessTechlinkEvidence(order({ result: { orderId: "ORD-77" } }), [row({ orderId: "ORD-77", phoneNumber: "0200000000", amount: 50 })], { exhausted: true });
    expect(ev.verdict).toBe("delivered");
  });

  it("does not credit a Techlink row that already belongs to another of our orders", () => {
    const ev = assessTechlinkEvidence(order(), [row()], { exhausted: true, claimedOrderIds: new Set(["ORD-1"]) });
    expect(ev.verdict).toBe("not_found");
    expect(retryIsSafe(ev)).toBe(true);
  });

  it("ignores Techlink orders for other people, other amounts, or from before this order", () => {
    const rows = [row({ phoneNumber: "0209999999" }), row({ amount: 10, costPrice: 10 }), row({ createdAt: "2026-09-29T10:00:00Z" })];
    expect(assessTechlinkEvidence(order(), rows, { exhausted: true }).verdict).toBe("not_found");
  });

  it("reports in-progress and failed orders distinctly", () => {
    expect(assessTechlinkEvidence(order(), [row({ status: "processing" })], { exhausted: true }).verdict).toBe("in_progress");
    const failed = assessTechlinkEvidence(order(), [row({ status: "failed" })], { exhausted: true });
    expect(failed.verdict).toBe("failed_at_provider");
    expect(retryIsSafe(failed)).toBe(true);
    expect(retryIsSafe(assessTechlinkEvidence(order(), [row({ status: "processing" })], { exhausted: true }))).toBe(false);
  });

  it("only says 'not found' when the history actually reaches back far enough", () => {
    expect(assessTechlinkEvidence(order(), [], { exhausted: false, oldestFetchedAt: "2026-09-30T12:00:00Z" }).verdict).toBe("unknown");
    expect(assessTechlinkEvidence(order(), [], { exhausted: false, oldestFetchedAt: "2026-09-30T08:00:00Z" }).verdict).toBe("not_found");
    expect(assessTechlinkEvidence(order(), [], { exhausted: true }).verdict).toBe("not_found");
  });

  it("will not guess for multi-recipient orders", () => {
    expect(assessTechlinkEvidence(order({ phone: "5 recipients" }), [row()], { exhausted: true }).verdict).toBe("not_checkable");
  });

  it("never blocks a retry when it cannot tell", () => {
    expect(retryIsSafe({ verdict: "unknown" })).toBe(true);
    expect(retryIsSafe(undefined)).toBe(true);
  });
});
