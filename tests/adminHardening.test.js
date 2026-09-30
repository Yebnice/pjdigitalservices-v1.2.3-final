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
      "pages/api/admin/reconcile.js",
      "pages/api/admin/wallet-balance.js",
      "pages/api/admin/reviews.js",
    ]) {
      expect(read(file)).toContain('requireAdminRole(req, res, ["operator"])');
    }
  });

  // Exporting every customer's phone and email is a bulk-PII action, and
  // marking a paid order delivered closes it out without provider proof.
  it("reserves bulk export and manual delivery confirmation for admins", () => {
    expect(read("pages/api/admin/export-orders.js")).toContain('requireAdminPermission(req, res, "orders.export")');
    expect(read("pages/api/orders/manual-review.js")).toContain('action === "confirm_fulfilled" && !adminHasRole(req, ["admin"])');
    expect(read("lib/adminPermissions.js")).toContain('"orders.export": "admin"');
    expect(read("lib/adminPermissions.js")).toContain('"orders.confirm_fulfilled": "admin"');
  });

  it("audits failed admin sign-ins", () => {
    expect(read("pages/api/admin/login.js")).toContain('action: "admin_login_failed"');
  });

  it("strips sensitive fields from every admin order response", () => {
    for (const file of ["pages/api/admin/orders.js", "pages/api/orders/list.js", "pages/api/orders/manual-review.js", "pages/api/admin/recheck-order.js"]) {
      expect(read(file)).toContain("toAdminOrder");
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
    // The dashboard only calls an endpoint when the signed-in role has the
    // permission for it; a viewer never hits the operator-only wallet route.
    expect(read("pages/admin/index.js")).toContain('can("wallet.view") ? adminApi("/api/admin/wallet-balance"');
    expect(read("pages/admin/index.js")).toContain('can("orders.process") ? adminApi("/api/orders/manual-review"');
  });
});
