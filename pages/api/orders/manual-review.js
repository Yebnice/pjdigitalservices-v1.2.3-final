import { requireAdminRole } from "../../../lib/adminAuth";
import { listManualReviewOrders, manuallyResolveOrder } from "../../../lib/store";
import { notifyCustomerOrderFulfilled, notifyCustomerOrderSms } from "../../../lib/notifications";
import { recordAuditEvent } from "../../../lib/auditLog";

export default async function handler(req, res) {
  const actor = requireAdminRole(req, res, ["operator"]);\n  if (!actor) return;
  if (req.method === "GET") {
    try {
      return res.status(200).json({ orders: await listManualReviewOrders() });
    } catch (err) {
      console.error("Manual review list error", err);
      return res.status(500).json({ error: "Could not load manual review orders" });
    }
  }
  if (req.method === "POST") {
    try {
      const { reference, action, note } = req.body || {};
      if (!reference || !action || !note) return res.status(400).json({ error: "reference, action and confirmation note are required" });
      const order = await manuallyResolveOrder(String(reference).trim(), action, note);
      if (!order) return res.status(404).json({ error: "Manual-review order not found or already resolved" });
      await recordAuditEvent({ actor: actor.username, action: `manual_review_${action}`, reference, note });
      // This is the OTHER route to "fulfilled" besides the automated worker
      // (lib/orderProcessing.js's fulfillClaimedOrder) — it bypasses that
      // function's DB update entirely, so it needs its own copy of the same
      // delivery-confirmation call. These are exactly the orders that took
      // longest to resolve, so the customer confirmation matters most here.
      if (action === "confirm_fulfilled") {
        try {
          await notifyCustomerOrderFulfilled(order);
        } catch (err) {
          console.error("Customer delivery confirmation failed (manual review)", reference, err);
        }
        try {
          await notifyCustomerOrderSms(order);
        } catch (err) {
          console.error("Customer delivery SMS failed (manual review)", reference, err);
        }
      }
      return res.status(200).json({ order });
    } catch (err) {
      console.error("Manual review action error", err);
      return res.status(400).json({ error: err.message });
    }
  }
  return res.status(405).json({ error: "Method not allowed" });
}
