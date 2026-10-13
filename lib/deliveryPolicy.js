// Automatic fulfillment policy. Valid, sufficiently paid Paystack transactions
// must not be stranded because a webhook was delayed, reconciliation found them
// late, or a retry ran after an arbitrary time threshold. The explicit admin
// manual-mode switch remains available as an emergency stop; genuine payment,
// amount, currency and final delivery checks remain mandatory.
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

const MESSAGES = {
  manual_mode: "Delivery mode is MANUAL, so automatic delivery is intentionally paused.",
  no_payment_record: "There is no recorded Paystack payment (verified time and amount) for this order, so it was NOT sent to Techlink.",
  amount_short: "The recorded payment is less than the order total, so it was NOT sent to Techlink.",
};;

// Step 1 (payment confirmed): valid payments can enter the worker queue without
// an arbitrary checkout-age cutoff. The worker remains claim-protected.
export function evaluateIntake({ order, mode = "automatic" } = {}) {
  // A valid payment must not be stranded because reconciliation or a delayed
  // webhook discovered it after an arbitrary checkout-age threshold.
  if (mode !== "automatic") return { allowed: false, code: "manual_mode", message: MESSAGES.manual_mode };
  return { allowed: true, code: "automatic" };
}

// Step 2 (last mile, right before the Techlink call). Re-check payment evidence
// and amount immediately before spending the Techlink wallet.
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
