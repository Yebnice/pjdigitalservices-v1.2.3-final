import { requireAdminRole, adminHasRole } from "../../../lib/adminAuth";
import { toAdminOrder } from "../../../lib/adminOrders";
import { listManualReviewOrders, manuallyResolveOrder, getOrder } from "../../../lib/store";
import { notifyCustomerOrderFulfilled, notifyCustomerOrderSms } from "../../../lib/notifications";
import { verifyAndFulfillOrder, fulfillClaimedOrder } from "../../../lib/orderProcessing";
import { recordAuditEvent } from "../../../lib/auditLog";

// verifyAndFulfillOrder / fulfillClaimedOrder return an outcome that can carry
// the full order (with provider secrets); only pass the safe view on.
function toAdminResult(result) {
  if (!result || typeof result !== "object") return result;
  return { ...result, ...(result.order ? { order: toAdminOrder(result.order) } : {}) };
}

export default async function handler(req, res) {
  const actor = requireAdminRole(req, res, ["operator"]);
  if (!actor) return;
  if (req.method === "GET") {
    try {
      return res.status(200).json({ orders: (await listManualReviewOrders()).map(toAdminOrder) });
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

      // Marking a paid order as delivered closes it out and tells the customer
      // it arrived, with no provider proof — that is a money decision, so it
      // needs the admin role. Operators can still re-check, process and retry.
      if (action === "confirm_fulfilled" && !adminHasRole(req, ["admin"])) {
        return res.status(403).json({ error: "Only an admin can mark an order as delivered manually" });
      }
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
        return res.status(200).json({ result: toAdminResult(result) });
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
        return res.status(200).json({ result: toAdminResult(result) });
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
      return res.status(200).json({ order: toAdminOrder(order) });
    } catch (err) {
      console.error("Manual review action error", err);
      return res.status(400).json({ error: err.message });
    }
  }
  return res.status(405).json({ error: "Method not allowed" });
}
