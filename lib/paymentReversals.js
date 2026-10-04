// Refunds and disputes (chargebacks) change what your books should say, but they
// happen on Paystack AFTER delivery, so nothing in the order flow sees them.
// This module records them (in the audit log, matched to the order) so the
// accounts are not silently wrong. It is RECORD-ONLY: it never changes an order's
// status, never delivers, never refunds.
//
// Event names are from Paystack's webhook documentation:
//   refund.pending | refund.processing | refund.processed | refund.failed
//   charge.dispute.create | charge.dispute.remind | charge.dispute.resolve
//
// Paystack's exact payload FIELD names for these events are not relied on. The
// order is found by looking for any short text value in the payload that equals
// one of our order references, wherever it sits.
import crypto from "crypto";
import { getSupabase } from "./supabaseClient";
import { recordAuditEvent } from "./auditLog";

const REVERSAL_EVENT = /^(refund\.(pending|processing|processed|failed)|charge\.dispute\.(create|remind|resolve))$/;

export function isReversalEvent(name) {
  return REVERSAL_EVENT.test(String(name || ""));
}

// "refund.processed" -> "paystack_refund_processed"; "charge.dispute.create" -> "paystack_dispute_create"
export function reversalAction(name) {
  return `paystack_${String(name).replace(/^charge\./, "").replace(/\./g, "_")}`;
}

// Every action name reversalAction() can produce: an exact list, so counting needs no wildcard.
export const REVERSAL_ACTIONS = [
  "paystack_refund_pending", "paystack_refund_processing", "paystack_refund_processed", "paystack_refund_failed",
  "paystack_dispute_create", "paystack_dispute_remind", "paystack_dispute_resolve",
];

const REFERENCE_LIKE = /^[A-Za-z0-9._-]{6,80}$/;

// Every short, reference-looking text value anywhere in the payload (bounded).
export function collectReferenceCandidates(value, { maxDepth = 6, maxItems = 60 } = {}) {
  const found = new Set();
  const walk = (v, depth) => {
    if (found.size >= maxItems || depth > maxDepth || v == null) return;
    if (typeof v === "string") { if (REFERENCE_LIKE.test(v)) found.add(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === "object") { for (const x of Object.values(v)) walk(x, depth + 1); }
  };
  walk(value, 0);
  return [...found];
}

async function findOrders(candidates) {
  if (!candidates.length) return [];
  const { data, error } = await getSupabase().from("orders").select("reference,order_no,status,fulfilled,checkout_amount,amount").in("reference", candidates);
  if (error) throw new Error(error.message);
  return data || [];
}

async function alreadyRecorded(action, reference, note) {
  let q = getSupabase().from("audit_log").select("id").eq("action", action).eq("note", note);
  q = reference ? q.eq("reference", reference) : q.is("reference", null);
  const { data, error } = await q.limit(1);
  if (error) return false; // if we cannot tell, record it: a duplicate row is better than a lost one
  return (data || []).length > 0;
}

// Throws on a database error so the webhook answers 5xx and Paystack retries.
export async function recordReversalEvent(event) {
  const name = String(event?.event || "");
  const action = reversalAction(name);
  const tag = crypto.createHash("sha256").update(JSON.stringify(event)).digest("hex").slice(0, 10);
  const orders = await findOrders(collectReferenceCandidates(event?.data));
  const guidance = "Check the amount and any deadline in the Paystack dashboard, and decide whether the customer keeps the goods.";

  if (!orders.length) {
    const note = `${name}: no matching order found for this notice. ${guidance} [event ${tag}]`;
    if (!(await alreadyRecorded(action, null, note))) await recordAuditEvent({ actor: "paystack", action, reference: null, note });
    return { recorded: 1, matched: 0 };
  }
  let recorded = 0;
  for (const o of orders) {
    const delivered = o.fulfilled || o.status === "success";
    const label = o.order_no || o.reference;
    const note = `${name} for order ${label} (${delivered ? "ALREADY DELIVERED" : "not delivered"}, order total GHS ${Number(o.checkout_amount ?? o.amount).toFixed(2)}). ${guidance} [event ${tag}]`;
    if (await alreadyRecorded(action, o.reference, note)) continue;
    await recordAuditEvent({ actor: "paystack", action, reference: o.reference, note });
    recorded += 1;
  }
  return { recorded, matched: orders.length };
}

// Count for the admin dashboard banner. Never throws.
export async function countRecentReversalEvents(days = 30) {
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const { data, error } = await getSupabase().from("audit_log").select("id")
      .in("action", REVERSAL_ACTIONS).gte("created_at", since).limit(500);
    return error ? null : (data || []).length;
  } catch { return null; }
}
