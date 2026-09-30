// One place that says who may do what in the admin dashboard.
//
//   viewer   read-only: overview, orders, feedback and reviews
//   operator viewer + day-to-day operations: re-check / process / retry orders,
//            update feedback, moderate reviews, reconcile, wallet, audit log
//   admin    operator + the actions that move money or expose bulk customer
//            data: manually marking a paid order as delivered (which also
//            emails/texts the customer that it arrived) and the full orders
//            CSV export
//
// The server enforces this on every request; the dashboard reads the same map
// (via /api/admin/me) only to hide buttons the person could not use anyway.

export const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };

export const PERMISSIONS = {
  "overview.view": "viewer",
  "orders.view": "viewer",
  "feedback.view": "viewer",
  "reviews.view": "viewer",
  "wallet.view": "operator",
  "audit.view": "operator",
  "orders.recheck": "operator",
  "orders.process": "operator", // verify payment, send to Techlink, authorise a retry
  "feedback.update": "operator",
  "reviews.moderate": "operator",
  "reconcile.run": "operator",
  "orders.confirm_fulfilled": "admin",
  "orders.export": "admin",
};

// Anything that is not exactly a known role gets the LOWEST role, never the
// highest: a typo or a missing "role" must not quietly create an admin.
export function normalizeRole(role) {
  const clean = String(role || "").trim().toLowerCase();
  return ROLE_RANK[clean] ? clean : "viewer";
}

export function roleHas(role, permission) {
  const needed = PERMISSIONS[permission];
  if (!needed) return false; // unknown permission: deny
  return (ROLE_RANK[normalizeRole(role)] || 0) >= ROLE_RANK[needed];
}

export function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter((permission) => roleHas(role, permission));
}
