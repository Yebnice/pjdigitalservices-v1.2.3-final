export function getOrderStatusLabel(order) {
  const status = String(order?.status || "").toLowerCase();
  const fulfillment = String(order?.fulfillmentStatus || "").toLowerCase();

  if (order?.fulfilled || fulfillment === "fulfilled" || status === "success") {
    return "Delivered";
  }
  if (order?.failReason === "payment_abandoned") {
    return "Payment cancelled";
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
