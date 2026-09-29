import { requireAdminRole } from "../../../lib/adminAuth";
import { listManualReviewOrders, manuallyResolveOrder, getOrder } from "../../../lib/store";
import { notifyCustomerOrderFulfilled, notifyCustomerOrderSms } from "../../../lib/notifications";
import { verifyAndFulfillOrder, fulfillClaimedOrder } from "../../../lib/orderProcessing";
import { recordAuditEvent } from "../../../lib/auditLog";

export default async function handler(req, res) {
  const actor = requireAdminRole(req, res, ["operator"]);
  if (!actor) return;
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

      const cleanReference = String(reference).trim();
      const current = await getOrder(cleanReference);
      if (!current) return res.status(404).json({ error: "Order not found" });

      // A payment can be verified manually after a webhook/callback delay.
      // This path is intentionally limited to orders that have not yet been
      // verified and does not call Techlink unless Paystack reports success.
      if (action === "verify_and_process") {
        if (current.fulfilled) return res.status(409).json({ error: "Order is already fulfilled" });
        if (!["pending", "payment_pending"].includes(current.status)) {
          return res.status(409).json({ error: "This order no longer needs payment verification" });
        }
        const result = await verifyAndFulfillOrder(cleanReference);
        await recordAuditEvent({
          actor: actor.username,
          action: "admin_verify_and_process",
          reference: cleanReference,
          note: String(note).trim().slice(0, 2000),
        });
        return res.status(200).json({ result });
      }

      // A verified/ready order has a confirmed Paystack payment but has not
      // reached the provider yet. Allow the operator to push it to Techlink
      // immediately instead of waiting for the scheduled worker.
      if (action === "process_now") {
        if (current.fulfilled) return res.status(409).json({ error: "Order is already fulfilled" });
        if (current.status !== "payment_verified" || current.fulfillmentStatus !== "ready") {
          return res.status(409).json({ error: "Only a payment-verified order waiting for fulfillment can be processed now" });
        }
        const result = await fulfillClaimedOrder(cleanReference);
        await recordAuditEvent({
          actor: actor.username,
          action: "admin_process_now",
          reference: cleanReference,
          note: String(note).trim().slice(0, 2000),
        });
        return res.status(200).json({ result });
      }

      const order = await manuallyResolveOrder(cleanReference, action, note);
      if (!order) return res.status(404).json({ error: "Order not found in a resolvable state or already resolved" });
      await recordAuditEvent({ actor: actor.username, action: `manual_review_${action}`, reference: cleanReference, note });

      if (action === "confirm_fulfilled") {
        try {
          await notifyCustomerOrderFulfilled(order);
        } catch (err) {
          console.error("Customer delivery confirmation failed (manual review)", cleanReference, err);
        }
        try {
          await notifyCustomerOrderSms(order);
        } catch (err) {
          console.error("Customer delivery SMS failed (manual review)", cleanReference, err);
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
