import { describe, expect, it } from "vitest";
import { PERMISSIONS, normalizeRole, permissionsFor, roleHas } from "../lib/adminPermissions.js";

describe("admin permission map", () => {
  it("gives viewers read-only access", () => {
    for (const p of ["overview.view", "orders.view", "feedback.view", "reviews.view"]) expect(roleHas("viewer", p)).toBe(true);
    for (const p of ["orders.process", "orders.recheck", "wallet.view", "audit.view", "reconcile.run", "orders.export", "orders.confirm_fulfilled"]) {
      expect(roleHas("viewer", p)).toBe(false);
    }
  });

  it("lets operators run day-to-day operations but not money-moving or bulk-data actions", () => {
    for (const p of ["orders.process", "orders.recheck", "wallet.view", "audit.view", "reconcile.run", "feedback.update", "reviews.moderate"]) {
      expect(roleHas("operator", p)).toBe(true);
    }
    expect(roleHas("operator", "orders.confirm_fulfilled")).toBe(false);
    expect(roleHas("operator", "orders.export")).toBe(false);
  });

  it("lets admins do everything", () => {
    for (const p of Object.keys(PERMISSIONS)) expect(roleHas("admin", p)).toBe(true);
  });

  it("denies unknown permissions for every role", () => {
    expect(roleHas("admin", "orders.delete_everything")).toBe(false);
  });

  it("treats a missing, misspelt or unknown role as the LOWEST role, never admin", () => {
    for (const bad of [undefined, null, "", "adminn", "superuser", "  "]) expect(normalizeRole(bad)).toBe("viewer");
    expect(normalizeRole(" Admin ")).toBe("admin");
    expect(roleHas("adminn", "orders.export")).toBe(false);
  });

  it("lists exactly what a role can do", () => {
    expect(permissionsFor("viewer")).toEqual(["overview.view", "orders.view", "feedback.view", "reviews.view"]);
    expect(permissionsFor("admin")).toHaveLength(Object.keys(PERMISSIONS).length);
  });

  it("keeps full manual control (mark delivered / resolved / paid) with admins only", () => {
    expect(roleHas("admin", "orders.manual_control")).toBe(true);
    expect(roleHas("operator", "orders.manual_control")).toBe(false);
    expect(roleHas("viewer", "orders.manual_control")).toBe(false);
  });

  it("lets operators close an order only on Techlink evidence, run the worker and see system health", () => {
    for (const p of ["orders.confirm_from_evidence", "worker.run", "system.view"]) expect(roleHas("operator", p)).toBe(true);
    for (const p of ["orders.accept_charged", "orders.close_charged"]) expect(roleHas("operator", p)).toBe(false);
    expect(roleHas("viewer", "system.view")).toBe(false);
  });
});
