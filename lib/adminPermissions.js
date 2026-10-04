// One place that says who may do what in the admin dashboard.
//
//   viewer   read-only: overview, orders, feedback and reviews
//   operator viewer + day-to-day operations: re-check / process / retry orders,
//            close an order when Techlink's own history proves it was
//            delivered, run the worker, update feedback, moderate reviews,
//            reconcile, wallet, audit log
//   admin    operator + the actions that move money or expose bulk customer
//            data: marking a paid order as delivered WITHOUT provider proof
//            (which also emails/texts the customer that it arrived), honouring
//            or closing a payment we rejected, and the full orders CSV export
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
  "system.view": "operator", // worker heartbeat, webhook queue health
  "worker.run": "operator", // run the background worker now
  // Closing an order because TECHLINK ITSELF shows it delivered. The server
  // re-checks Techlink's history; the browser's word is never taken.
  "orders.confirm_from_evidence": "operator",
  "orders.confirm_fulfilled": "admin", // marking delivered with NO provider proof
  "orders.accept_charged": "admin", // honour a payment we rejected (customer was charged)
  "orders.close_charged": "admin", // record that a charged-but-rejected order was refunded/handled
  // Full manual override on any stuck order, independent of the Paystack and
  // Techlink API checks: mark delivered, mark resolved, mark paid and send.
  "orders.manual_control": "admin",
  "orders.export": "admin",
  // Spending Techlink wallet money on a held or stuck order: Approve & deliver, Send now,
  // Authorise retry. The role required is set at call time by WALLET_SPEND_ROLE
  // ("admin" by default = two-person control; "operator" to relax). See requiredRole().
  "orders.spend_wallet": "admin",
};

function requiredRole(permission, env = process.env) {
  if (permission === "orders.spend_wallet") {
    return String(env.WALLET_SPEND_ROLE || "").trim().toLowerCase() === "operator" ? "operator" : "admin";
  }
  return PERMISSIONS[permission];
}

// Anything that is not exactly a known role gets the LOWEST role, never the
// highest: a typo or a missing "role" must not quietly create an admin.
export function normalizeRole(role) {
  const clean = String(role || "").trim().toLowerCase();
  return ROLE_RANK[clean] ? clean : "viewer";
}

export function roleHas(role, permission) {
  const needed = requiredRole(permission);
  if (!needed) return false; // unknown permission: deny
  return (ROLE_RANK[normalizeRole(role)] || 0) >= ROLE_RANK[needed];
}

export function permissionsFor(role) {
  return Object.keys(PERMISSIONS).filter((permission) => roleHas(role, permission));
}
