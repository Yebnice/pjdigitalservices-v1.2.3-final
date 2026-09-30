// Shared helpers for what the admin dashboard is allowed to see of an order,
// and how the Orders tab filters and pages them. Pure functions only (no
// database access) so they can be unit-tested without Supabase.

// The provider `result` blob can contain cash-equivalent secrets: result-checker
// serial numbers and PINs, electricity tokens, and so on. The dashboard only
// ever needs the provider's order id and the manual-confirmation audit fields.
const SAFE_RESULT_KEYS = ["orderId", "message", "status", "manualConfirmation", "manualConfirmationNote", "confirmedAt"];

function safeResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  const out = {};
  for (const key of SAFE_RESULT_KEYS) {
    if (result[key] != null) out[key] = typeof result[key] === "string" ? result[key].slice(0, 500) : result[key];
  }
  return Object.keys(out).length ? out : null;
}

// AFA details include the Ghana Card number and date of birth (stored
// encrypted precisely because they are sensitive). They were being decrypted
// for every AFA order and sent to the browser on every dashboard load.
export function toAdminOrder(order) {
  if (!order || typeof order !== "object") return order;
  const { afaDetails, idempotencyKey, result, checkerDetails, ...rest } = order;
  return {
    ...rest,
    result: safeResult(result),
    hasAfaDetails: Boolean(afaDetails),
    afaName: afaDetails?.fullName || afaDetails?.name || null,
    checkerMode: checkerDetails?.mode || null,
  };
}

// Orders-tab filters. Each maps to plain Supabase filter calls in
// listOrdersPage(). Deliberately no filter needs its own OR clause, so a text
// search (which does use one) can always be combined with any of them.
export const ORDER_FILTERS = {
  all: { label: "All" },
  attention: { label: "Needs attention", in: ["fulfillment_status", ["manual_review", "failed", "queued_with_provider"]] },
  paid_undelivered: { label: "Paid, not delivered", eq: [["status", "payment_verified"], ["fulfilled", false]] },
  fulfilled: { label: "Fulfilled", eq: [["fulfilled", true]] },
  failed_delivery: { label: "Delivery failed", in: ["fulfillment_status", ["failed"]] },
  payment_failed: { label: "Payment failed", in: ["status", ["payment_failed", "failed"]] },
  unpaid: { label: "Awaiting payment", in: ["status", ["pending", "payment_pending"]] },
  abandoned: { label: "Abandoned checkouts", eq: [["fail_reason", "payment_abandoned"]] },
};

// The search box text ends up inside a PostgREST `or=(...)` string. Commas,
// parentheses and wildcards there would let a search term change the meaning
// of the filter, so only characters that can appear in a reference, phone
// number, email or order type survive.
export function sanitizeSearchTerm(raw) {
  return String(raw || "")
    .replace(/[^A-Za-z0-9@._+\-\s]/g, "")
    .trim()
    .slice(0, 64);
}

export function normalizePageParams({ page, pageSize } = {}) {
  const size = Math.min(100, Math.max(5, Math.floor(Number(pageSize)) || 25));
  const pg = Math.max(1, Math.floor(Number(page)) || 1);
  return { page: pg, pageSize: size, from: (pg - 1) * size, to: pg * size - 1 };
}

export function parseIsoDate(value) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Supabase/PostgREST returns at most 1,000 rows per request (the project's
// "max rows" setting), and returns them WITHOUT an error. A plain
// `select("*")` therefore silently truncated every all-orders view — the
// dashboard totals, the CSV export and the Paystack reconciliation — as soon
// as the business passed 1,000 orders. This walks the table page by page.
//
// `fetchPage(from, to)` must return a promise of { data, error } for that
// inclusive row range, ordered stably. Lives here (not in store.js) so it can be unit-tested without a database.
export async function fetchAllRows(fetchPage, pageSize = 1000, maxRows = 200000) {
  const all = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}
