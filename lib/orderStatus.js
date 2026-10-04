// A checkout nobody paid. The code is "payment_abandoned"; "abandoned" is what older versions
// of the sweep stored (Paystack's own word), so both are recognised and the data fix in
// supabase/migration_v1_4_3.sql normalises the old rows.
export const ABANDONED_REASONS = ["payment_abandoned", "abandoned"];
export const isAbandonedOrder = (order) => ABANDONED_REASONS.includes(order?.failReason);

export function getOrderStatusLabel(order) {
  const status = String(order?.status || "").toLowerCase();
  const fulfillment = String(order?.fulfillmentStatus || "").toLowerCase();

  if (order?.fulfilled || fulfillment === "fulfilled" || status === "success") {
    return "Delivered";
  }
  if (isAbandonedOrder(order)) {
    return "Payment abandoned";
  }
  if (fulfillment === "resolved") {
    return "Closed by support";
  }
  // Paystack took the money but the amount did not match. The customer HAS
  // paid, so never tell them "Processing" or "Payment failed": say we are on it.
  if (status === "payment_failed" && ["amount_mismatch", "currency_mismatch"].includes(order?.failReason)) {
    return "Payment received — under review";
  }
  if (status === "payment_failed") {
    return "Payment failed";
  }
  if (fulfillment === "queued_with_provider") {
    return "Queued for delivery";
  }
  if (status === "payment_verified") {
    switch (fulfillment) {
      case "ready":
        return "Payment received — awaiting fulfillment";
      case "processing":
        return "Payment received — processing";
      case "manual_review":
        return "Payment received — under review";
      case "failed":
        return "Payment received — fulfillment failed";
      default:
        return "Payment received";
    }
  }
  if (status === "payment_pending" || status === "pending") {
    return "Payment pending";
  }
  if (status === "failed") {
    return "Payment failed";
  }
  return "Processing";
}
