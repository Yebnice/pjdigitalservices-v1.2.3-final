import { verifyTransaction } from "../../../lib/paystack";
import { getOrder, markFailed, toPublicOrder } from "../../../lib/store";
import { rateLimit } from "../../../lib/rateLimit";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const rl = rateLimit(req, { limit: 8, windowMs: 60_000, keySuffix: "order-abandon" });
  if (!rl.allowed) {
    return res.status(429).setHeader("Retry-After", rl.retryAfter).json({
      error: "Too many requests. Please wait a moment.",
    });
  }

  try {
    const reference = String(req.body?.reference || "").trim();
    if (!reference) return res.status(400).json({ error: "reference is required" });

    const order = await getOrder(reference);
    if (!order) return res.status(404).json({ error: "Unknown order" });
    if (order.fulfilled) return res.status(200).json({ order: toPublicOrder(order), unchanged: true });

    // A customer can close the Paystack popup before paying. The order row is
    // created before the popup opens, so we must not leave that unpaid row
    // looking like a real in-progress order. Verify Paystack first so a race
    // where payment actually succeeded is never cancelled.
    let txn;
    try {
      txn = await verifyTransaction(reference);
    } catch (err) {
      console.warn("Could not verify closed Paystack popup:", reference, err.message);
      return res.status(202).json({
        order: toPublicOrder(order),
        status: "pending",
        verified: false,
      });
    }

    const paystackStatus = String(txn?.status || "").toLowerCase();

    if (paystackStatus === "success") {
      return res.status(200).json({
        order: toPublicOrder(order),
        status: "success",
        unchanged: true,
      });
    }

    if (["abandoned", "failed", "cancelled", "canceled"].includes(paystackStatus)) {
      const updated = await markFailed(reference, "payment_abandoned");
      return res.status(200).json({
        order: toPublicOrder(updated),
        status: "cancelled",
        unchanged: false,
      });
    }

    // Pending/ongoing/unknown provider states are left untouched. The worker
    // should never attempt fulfillment until Paystack confirms success.
    return res.status(202).json({
      order: toPublicOrder(order),
      status: paystackStatus || "pending",
      verified: true,
    });
  } catch (err) {
    console.error("Order abandonment handling failed", err);
    return res.status(500).json({ error: "Could not update the cancelled payment right now." });
  }
}
