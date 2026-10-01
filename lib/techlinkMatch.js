import { toLocalGhanaNumber } from "./networkValidation";

// Decides, from Techlink's own order history, whether one of OUR orders was
// already delivered — so an admin is never asked to guess before choosing
// between "mark delivered" (it arrived) and "retry" (it did not, send again).
// Guessing wrong either way is expensive: a wrong retry delivers twice and
// costs real wallet money; a wrong "delivered" leaves a paid customer waiting.
//
// Pure functions only (no network), so the matching rules can be unit-tested.

const DELIVERED = ["completed", "complete", "success", "successful", "delivered", "fulfilled", "done"];
const FAILED = ["failed", "cancelled", "canceled", "refunded", "rejected", "reversed", "error", "declined"];

export function classifyTechlinkStatus(status) {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return "unknown";
  if (DELIVERED.includes(s)) return "delivered";
  if (FAILED.includes(s)) return "failed";
  return "in_progress";
}

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function normalizeTechlinkRow(row) {
  if (!row || typeof row !== "object") return null;
  const phoneRaw = row.phoneNumber ?? row.phone ?? row.recipient ?? row.msisdn ?? "";
  return {
    orderId: String(row.orderId ?? row.reference ?? row.id ?? "").trim() || null,
    phone: toLocalGhanaNumber(phoneRaw) || String(phoneRaw || "").replace(/\D/g, ""),
    amount: num(row.amount),
    costPrice: num(row.costPrice ?? row.cost_price),
    status: String(row.status ?? row.orderStatus ?? ""),
    statusClass: classifyTechlinkStatus(row.status ?? row.orderStatus),
    createdAt: row.createdAt ?? row.created_at ?? null,
    productName: String(row.productName ?? row.productType ?? row.name ?? ""),
  };
}

const AMOUNT_TOLERANCE = 0.05; // GHS
const TIME_SLACK_MS = 10 * 60 * 1000;

function amountMatches(row, candidates) {
  return candidates.some((c) => (row.amount != null && Math.abs(row.amount - c) <= AMOUNT_TOLERANCE)
    || (row.costPrice != null && Math.abs(row.costPrice - c) <= AMOUNT_TOLERANCE));
}

/**
 * @param order  our order (needs phone, providerCost/amount, createdAt/paymentVerifiedAt, result?.orderId)
 * @param rows   raw rows from Techlink's order list
 * @param opts.exhausted      true when the fetch reached the end of Techlink's history
 * @param opts.oldestFetchedAt  ISO time of the oldest row fetched (proves the window was covered)
 * @param opts.claimedOrderIds  Set of Techlink order ids already recorded against OTHER orders of ours
 */
export function assessTechlinkEvidence(order, rows, { exhausted = false, oldestFetchedAt = null, claimedOrderIds = new Set() } = {}) {
  const normalized = (rows || []).map(normalizeTechlinkRow).filter(Boolean);
  const knownId = order?.result?.orderId ? String(order.result.orderId) : null;
  const phone = toLocalGhanaNumber(order?.phone);
  const shape = (r) => ({ orderId: r.orderId, status: r.status, statusClass: r.statusClass, amount: r.amount, createdAt: r.createdAt, productName: r.productName });

  // 1. We already hold Techlink's own order id: an exact lookup beats any guess.
  if (knownId) {
    const exact = normalized.filter((r) => r.orderId === knownId);
    if (exact.length) return finish(exact, "matched by Techlink order id");
  }

  // 2. Bulk / Excel orders have no single recipient to match on.
  if (!phone) {
    return { verdict: "not_checkable", matches: [], note: "This order has several recipients, so it cannot be matched automatically. Check each recipient in Techlink before doing anything." };
  }

  const candidates = [num(order.providerCost), num(order.amount)].filter((v) => v != null);
  const since = new Date(order.paymentVerifiedAt || order.createdAt || 0).getTime() - TIME_SLACK_MS;

  const matches = normalized.filter((r) => {
    if (r.phone !== phone) return false;
    if (!amountMatches(r, candidates)) return false;
    if (r.orderId && claimedOrderIds.has(r.orderId)) return false; // belongs to a different order of ours
    if (!r.createdAt) return true;
    const t = new Date(r.createdAt).getTime();
    return Number.isNaN(t) ? true : t >= since;
  });
  if (matches.length) return finish(matches, "matched by recipient, amount and time");

  // 3. Nothing matched. That only means "not delivered" if we actually looked
  //    far enough back to cover the time this order was placed.
  const covered = exhausted || (oldestFetchedAt && new Date(oldestFetchedAt).getTime() <= since);
  if (covered) return { verdict: "not_found", matches: [], note: "Techlink's history covers the time this order was placed and shows no matching order." };
  return { verdict: "unknown", matches: [], note: "No match in the part of Techlink's history that could be loaded. That is not proof it was not delivered — check Techlink directly." };

  function finish(found, how) {
    const delivered = found.filter((r) => r.statusClass === "delivered");
    const inProgress = found.filter((r) => r.statusClass === "in_progress" || r.statusClass === "unknown");
    if (delivered.length) return { verdict: "delivered", matches: found.map(shape), ambiguous: found.length > 1, note: `Techlink shows this order as delivered (${how}).` };
    if (inProgress.length) return { verdict: "in_progress", matches: found.map(shape), ambiguous: found.length > 1, note: `Techlink has this order but has not finished it yet (${how}).` };
    return { verdict: "failed_at_provider", matches: found.map(shape), ambiguous: found.length > 1, note: `Techlink shows this order as failed (${how}). It did not deliver, so a retry is safe.` };
  }
}

// A retry resubmits the order to Techlink. If Techlink already delivered it
// (or is still working on it), that would deliver twice.
export function retryIsSafe(evidence) {
  return !["delivered", "in_progress"].includes(evidence?.verdict);
}
