import { requireAdminPermission } from "../../../lib/adminAuth";
import { inspectChargedOrder } from "../../../lib/orderProcessing";

// For an order whose payment we rejected: what did Paystack actually take?
export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  if (!requireAdminPermission(req, res, "orders.process")) return;
  try {
    const reference = String(req.query.reference || "").trim();
    if (!reference) return res.status(400).json({ error: "reference is required" });
    // `txn` is Paystack's raw response (customer email, card details...). Only a
    // small, safe summary of it goes to the browser.
    const { order, txn, ...inspected } = await inspectChargedOrder(reference);
    if (inspected.verdict === "not_found") return res.status(404).json({ error: "Order not found" });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ...inspected,
      domain: txn?.domain ? String(txn.domain) : null,
      transactionId: txn?.id != null ? String(txn.id) : null,
      paidAt: txn?.paid_at || null,
      channel: txn?.channel ? String(txn.channel) : null,
      paystackFee: txn?.fees != null ? Number(txn.fees) / 100 : null,
    });
  } catch (err) {
    console.error("Payment check error", err);
    return res.status(500).json({ error: "Could not check Paystack right now" });
  }
}
