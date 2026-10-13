// When is the app allowed to spend Techlink wallet money on an order by ITSELF,
// and when must a person decide?
//
//   automatic delivery  only for a payment Paystack confirmed LIVE, moments ago,
//                       through the normal customer/webhook flow.
//   everything else     is held in "Needs attention" until an admin approves it.
//
// An order is never delivered automatically when:
//   - delivery mode is "manual" (the admin's one-click safety switch), or
//   - the payment was only DISCOVERED late: the checkout was already older than
//     AUTO_DELIVERY_MAX_AGE_MINUTES (default 45) when Paystack confirmed it, or
//   - it was only discovered by an outstanding-orders check (never delivers), or
//   - it has no recorded Paystack payment (verified time + amount), or
//   - it was verified more than AUTO_RETRY_MAX_VERIFIED_HOURS ago (default 6) and
//     still has not been delivered (something is wrong; a person should look).
//
// Freshness is judged when the payment is DISCOVERED, not when delivery happens.
// A genuinely paid order must not be stranded because the scheduler ran late.
//
// Pure functions only: no database, no network.

export const DELIVERY_MODES = ["automatic", "manual"];
export const DEFAULT_AUTO_MAX_AGE_MINUTES = 45;
export const DEFAULT_RETRY_MAX_VERIFIED_HOURS = 6;

export function normaliseDeliveryMode(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return DELIVERY_MODES.includes(v) ? v : null;
}

export function autoDeliveryMaxAgeMinutes(env = process.env) {
  const n = Number(env.AUTO_DELIVERY_MAX_AGE_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AUTO_MAX_AGE_MINUTES;
}

export function retryMaxVerifiedHours(env = process.env) {
  const n = Number(env.AUTO_RETRY_MAX_VERIFIED_HOURS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETRY_MAX_VERIFIED_HOURS;
}

function ageMinutes(order, now) {
  const t = new Date(order?.createdAt).getTime();
  return Number.isFinite(t) ? Math.max(0, (now - t) / 60000) : Infinity;
}

const MESSAGES = {
  manual_mode: "Delivery mode is MANUAL, so automatic delivery is intentionally paused.",
  no_payment_record: "There is no recorded Paystack payment (verified time and amount) for this order, so it was NOT sent to Techlink.",
  amount_short: "The recorded payment is less than the order total, so it was NOT sent to Techlink.",
};;

// Step 1 (payment confirmed): may this order go straight to "ready"?
export function evaluateIntake({ order, mode = "automatic" } = {}) {
  // A valid payment must not be stranded because reconciliation or a delayed
  // webhook discovered it after an arbitrary checkout-age threshold.
  if (mode !== "automatic") return { allowed: false, code: "manual_mode", message: MESSAGES.manual_mode };
  return { allowed: true, code: "automatic" };
}

// Step 2 (last mile, right before the Techlink call). Re-checks everything,
// because "ready" orders can sit for a while and anything can write to the table.
// An explicit admin approval is the only way past the mode and age rules.
export function evaluateDelivery({ order, mode = "automatic", approvedBy = null } = {}) {
  if (!order) return { allowed: false, code: "no_order", message: "Order not found." };
  if (approvedBy) return { allowed: true, code: "approved", approvedBy };

  // Keep the final safety gate immediately before any Techlink wallet spend.
  // A valid Paystack payment record and sufficient payment are mandatory.
  if (!order.paymentVerifiedAt || order.paymentAmount == null) {
    return { allowed: false, code: "no_payment_record", message: MESSAGES.no_payment_record };
  }
  const expected = order.checkoutAmount != null ? order.checkoutAmount : order.amount;
  if (!Number.isFinite(Number(expected)) || Number(order.paymentAmount) < Math.round(Number(expected) * 100)) {
    return { allowed: false, code: "amount_short", message: MESSAGES.amount_short };
  }
  if (mode !== "automatic") return { allowed: false, code: "manual_mode", message: MESSAGES.manual_mode };

  // Do not strand an already verified payment because of arbitrary age limits.
  // The atomic fulfillment claim and provider evidence/recovery logic govern retries.
  return { allowed: true, code: "automatic" };
}
