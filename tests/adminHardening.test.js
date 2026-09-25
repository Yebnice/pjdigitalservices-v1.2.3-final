import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

describe("admin hardening invariants", () => {
  it("requires viewer access for read-only admin order and feedback lists", () => {
    expect(read("pages/api/orders/list.js")).toContain('requireAdminRole(req, res, ["viewer"])');
    expect(read("pages/api/feedback/list.js")).toContain('requireAdminRole(req, res, ["viewer"])');
  });

  it("requires operator access for consequential admin actions", () => {
    for (const file of [
      "pages/api/orders/manual-review.js",
      "pages/api/feedback/status.js",
      "pages/api/admin/recheck-order.js",
      "pages/api/admin/export-orders.js",
      "pages/api/admin/reconcile.js",
      "pages/api/admin/wallet-balance.js",
      "pages/api/admin/reviews.js",
    ]) {
      expect(read(file)).toContain('requireAdminRole(req, res, ["operator"])');
    }
  });

  it("uses distributed login throttling and returns role metadata", () => {
    const source = read("pages/api/admin/login.js");
    expect(source).toContain('import { rateLimit } from "../../../lib/rateLimit"');
    expect(source).toContain('keySuffix: "admin-login"');
    expect(source).toContain("role: identity.role");
  });

  it("redacts reconciliation transaction details before optional AI summarization", () => {
    const source = read("pages/api/admin/reconcile.js");
    expect(source).toContain("buildAiSummaryPayload");
    expect(source).toContain("summarizeWithGemini(buildAiSummaryPayload(result))");
    expect(source).not.toContain("summarizeWithGemini(result)");
  });

  it("does not make viewer wallet checks hit an operator-only endpoint", () => {
    expect(read("pages/admin/index.js")).toContain("if (!auth || !canOperate)");
    expect(read("pages/admin/index.js")).toContain("}, [auth, canOperate]);");
  });
});
