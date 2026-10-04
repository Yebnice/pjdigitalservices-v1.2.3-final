import { requireAdminRole, adminHasRole } from "../../../lib/adminAuth";
import { roleHas } from "../../../lib/adminPermissions";
import { toAdminOrder, attentionCategory, attentionCounts } from "../../../lib/adminOrders";
import { retryIsSafe } from "../../../lib/techlinkMatch";
import { evidenceForOrder } from "../../../lib/adminEvidence";
import { listManualReviewOrders, listChargedButRejectedOrders, manuallyResolveOrder, manualOverride, getOrder } from "../../../lib/store";
import { notifyCustomerOrderFulfilled, notifyCustomerOrderSms } from "../../../lib/notifications";
import { verifyAndPrepareOrder, approveAndDeliver, fulfillClaimedOrder, acceptChargedOrder } from "../../../lib/orderProcessing";
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
      // Two sources: orders held in the normal pipeline, plus customers Paystack
      // CHARGED whose payment we rejected (which no list showed before).
      const [held, charged] = await Promise.all([listManualReviewOrders(), listChargedButRejectedOrders()]);
      const seen = new Set();
      const orders = [...charged, ...held]
        .filter((o) => (seen.has(o.reference) ? false : seen.add(o.reference)))
        .map((o) => ({ ...toAdminOrder(o), category: attentionCategory(o) }));
      // Each source is capped (50 / 50). If either hit its cap the list is not
      // the whole story, and the dashboard must say so rather than look complete.
      return res.status(200).json({ orders, counts: attentionCounts(orders), truncated: held.length >= 50 || charged.length >= 50 });
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
      // Spending Techlink wallet money on a held or stuck order (Approve & deliver,
      // Send now, Authorise retry) needs the role set by WALLET_SPEND_ROLE: admin by
      // default, so a day-to-day operator account can check and verify but cannot
      // spend. The server enforces this; the dashboard merely hides the buttons.
      if (["approve_delivery", "process_now", "retry"].includes(action) && !roleHas(actor.role, "orders.spend_wallet")) {
        return res.status(403).json({ error: "Spending wallet money on an order needs the admin role (set WALLET_SPEND_ROLE=operator to allow operators)" });
      }
      const current = await getOrder(cleanReference);
      if (!current) return res.status(404).json({ error: "Order not found" });

      // "Verify with Paystack": asks Paystack and RECORDS the answer. It never
      // sends anything to Techlink. A paid order is held in Needs attention, and
      // sending it is a separate, deliberate step: "Approve & deliver".
      if (action === "verify_and_process") {
        if (current.fulfilled) return res.status(409).json({ error: "Order is already fulfilled" });
        if (!["pending", "payment_pending", "payment_failed"].includes(current.status)) {
          return res.status(409).json({ error: "This order no longer needs payment verification" });
        }
        const result = await verifyAndPrepareOrder(cleanReference, { source: "review" });
        await recordAuditEvent({
          actor: actor.username,
          action: "admin_verify_with_paystack",
          reference: cleanReference,
          note: `${String(note).trim().slice(0, 1800)} [result: ${result.kind}${result.status ? ` / ${result.status}` : ""}; nothing sent to Techlink]`,
        });
        return res.status(200).json({ result: toAdminResult({ ...result, deliveries: 0 }) });
      }

      // The decision step. Re-checks Paystack itself (live, right reference,
      // enough money), checks Techlink's history so it cannot deliver twice, then
      // sends. The approving admin is recorded on the audit log.
      if (action === "approve_delivery") {
        if (current.fulfilled) return res.status(409).json({ error: "Order is already fulfilled" });
        const evidence = await evidenceForOrder(current);
        if (!retryIsSafe(evidence) && req.body?.force !== true) {
          return res.status(409).json({ error: `Not sent. ${evidence.note} Sending again would deliver it twice. If it really did not arrive, confirm to force it.`, evidence, canForce: roleHas(actor.role, "orders.manual_control") });
        }
        if (!retryIsSafe(evidence) && !roleHas(actor.role, "orders.manual_control")) {
          return res.status(403).json({ error: "Only an admin can force delivery against Techlink's evidence" });
        }
        const result = await approveAndDeliver(cleanReference, { approvedBy: actor.username });
        await recordAuditEvent({
          actor: actor.username,
          action: result.kind === "rejected" ? "admin_approve_delivery_refused" : "admin_approve_delivery",
          reference: cleanReference,
          note: `${String(note).trim().slice(0, 1500)}${result.kind === "rejected" ? ` [refused: ${result.message}]` : ""}${req.body?.force === true ? " [forced despite Techlink evidence]" : ""}`,
        });
        if (result.kind === "rejected") return res.status(409).json({ error: result.message, result });
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
        const result = await fulfillClaimedOrder(cleanReference, { approvedBy: actor.username });
        await recordAuditEvent({
          actor: actor.username,
          action: "admin_process_now",
          reference: cleanReference,
          note: String(note).trim().slice(0, 2000),
        });
        return res.status(200).json({ result: toAdminResult(result) });
      }

      // ---- Manual control --------------------------------------------------
      // The administrator's own decision, independent of the Paystack and
      // Techlink API checks (which stay available alongside). Admin only, a
      // note is mandatory, and every use is written to the audit log.
      if (["mark_delivered", "mark_resolved", "mark_paid_send"].includes(action)) {
        if (!roleHas(actor.role, "orders.manual_control")) return res.status(403).json({ error: "Only an admin can use manual controls" });
        const cleanNote = String(note).trim().slice(0, 2000);
        if (cleanNote.length < 5) return res.status(400).json({ error: "A note of at least 5 characters is required" });

        if (action === "mark_paid_send") {
          // Sending to Techlink spends wallet money. If Techlink already
          // delivered it (or is working on it), sending again delivers twice.
          const evidence = await evidenceForOrder(current);
          if (!retryIsSafe(evidence) && req.body?.force !== true) {
            return res.status(409).json({ error: `Not sent. ${evidence.note} Sending again would deliver it twice. If it really did not arrive, confirm to force it.`, evidence, canForce: true });
          }
          const paid = await manualOverride(cleanReference, "mark_paid", cleanNote);
          if (!paid) return res.status(404).json({ error: "Order not found or already delivered" });
          await recordAuditEvent({ actor: actor.username, action: "admin_mark_paid_send", reference: cleanReference, note: `${cleanNote}${req.body?.force === true ? " [forced despite Techlink evidence]" : ""}` });
          const result = await fulfillClaimedOrder(cleanReference, { approvedBy: actor.username });
          return res.status(200).json({ result: toAdminResult(result) });
        }

        const done = await manualOverride(cleanReference, action, cleanNote);
        if (!done) return res.status(404).json({ error: "Order not found or already delivered" });
        await recordAuditEvent({ actor: actor.username, action: `admin_${action}`, reference: cleanReference, note: cleanNote });
        if (action === "mark_delivered" && req.body?.notifyCustomer !== false) {
          try {
            await notifyCustomerOrderFulfilled(done);
          } catch (err) {
            console.error("Customer delivered notification failed after manual delivery", cleanReference, err);
          }
        }
        return res.status(200).json({ order: toAdminOrder(done) });
      }

      // The customer was charged but we rejected the payment. Both decisions
      // move or write off money, so both are admin-only, and the server checks
      // Paystack itself rather than trusting what the browser saw.
      if (action === "accept_charged") {
        if (!roleHas(actor.role, "orders.accept_charged")) return res.status(403).json({ error: "Only an admin can accept a payment that was rejected" });
        const result = await acceptChargedOrder(cleanReference, { approvedBy: actor.username });
        await recordAuditEvent({ actor: actor.username, action: "admin_accept_charged", reference: cleanReference, note: String(note).trim().slice(0, 2000) });
        return res.status(200).json({ result: toAdminResult(result) });
      }
      if (action === "close_charged" && !roleHas(actor.role, "orders.close_charged")) {
        return res.status(403).json({ error: "Only an admin can close a payment that was rejected" });
      }

      // Close an order because TECHLINK's own history shows it was delivered.
      // Evidence is re-fetched here; the note only records the operator's reason.
      let resolveAction = action;
      let resolveNote = note;
      if (action === "confirm_from_techlink") {
        if (!roleHas(actor.role, "orders.confirm_from_evidence")) return res.status(403).json({ error: "Insufficient admin permissions" });
        const evidence = await evidenceForOrder(current);
        if (evidence.verdict !== "delivered") {
          return res.status(409).json({ error: `Techlink's history does not show this order as delivered. ${evidence.note}`, evidence });
        }
        const ids = evidence.matches.filter((m) => m.statusClass === "delivered").map((m) => m.orderId).filter(Boolean).join(", ");
        resolveAction = "confirm_fulfilled";
        resolveNote = `Techlink shows delivered (${ids || "order id not shown"})${evidence.ambiguous ? " [several similar Techlink orders]" : ""}: ${String(note).trim()}`;
      }

      // A retry resubmits the order to Techlink. If Techlink already delivered
      // it, or is still working on it, that delivers twice and costs real money.
      // Only an admin can override, and only knowingly.
      if (action === "retry") {
        const evidence = await evidenceForOrder(current);
        if (!retryIsSafe(evidence)) {
          const forced = req.body?.force === true && adminHasRole(req, ["admin"]);
          if (!forced) {
            return res.status(409).json({ error: `Not retried. ${evidence.note} Retrying would deliver it twice. If it really did not arrive, an admin can force the retry.`, evidence, canForce: adminHasRole(req, ["admin"]) });
          }
          await recordAuditEvent({ actor: actor.username, action: "admin_forced_retry", reference: cleanReference, note: `Forced despite Techlink evidence "${evidence.verdict}": ${String(note).trim().slice(0, 1500)}` });
        }
      }

      const order = await manuallyResolveOrder(cleanReference, resolveAction, resolveNote);
      if (!order) return res.status(404).json({ error: "Order not found in a resolvable state or already resolved" });
      await recordAuditEvent({ actor: actor.username, action: `manual_review_${action}`, reference: cleanReference, note: resolveNote });

      // An authorised retry is the admin's own approval. Send it now, with that
      // approval attached; leaving it for the background worker would re-hold an
      // old order, because the worker never carries an approval.
      if (resolveAction === "retry") {
        const result = await fulfillClaimedOrder(cleanReference, { approvedBy: actor.username });
        return res.status(200).json({ order: toAdminOrder(order), result: toAdminResult(result) });
      }

      if (resolveAction === "confirm_fulfilled") {
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
