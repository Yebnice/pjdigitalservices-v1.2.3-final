import { verifyTransaction, isUnknownReferenceError } from "./paystack";
import {
  getOrder,
  markPaymentPending,
  markPaymentFailed,
  markPaymentVerified,
  holdPaidOrderForReview,
  markPaymentRejectedAfterCharge,
  manuallyResolveOrder,
  claimFulfillment,
  recoverStaleProcessingOrders,
  markFulfilled,
  markFulfillmentFailed,
  markFulfillmentAmbiguous,
  markHeldForManualReview,
  claimStaleQueuedAlerts,
  releaseQueuedAlert,
  listManualReviewAwaitingEscalation,
  markQueuedWithProvider,
  finalizeQueuedOrder,
  markQueuedOrderFailed,
  markManualReviewNotified,
  recordManualReviewNotified,
  markCustomerDelayNotified,
  recordCustomerDelayNotified,
  recordUrgentReviewNotified,
  listQueuedOrders,
  listStalePendingOrders,
} from "./store";
import { fulfillOrder, verifyOrderStatus, getWalletBalance, fetchRecentTechlinkOrders } from "./techlink";
import { assessTechlinkEvidence } from "./techlinkMatch";
import { readPaystackFees, readPaystackTransactionId, assessPaystackFee, describeFeeProblem } from "./feeCheck";
import { assessPaystackPayment, NOT_REAL_PAYMENT_CODES, isStrict } from "./paymentGuard";
import { techlinkKeyMode } from "./techlink";
import { vouchersComplete, isVoucherOrder } from "./vouchers";
import { PAYSTACK_PASS_FEES_TO_CUSTOMERS } from "./pricing";

// A checkout Paystack has never heard of is left alone this long (the customer may
// still be about to open the payment window), then closed as abandoned.
const UNOPENED_CHECKOUT_GRACE_MINUTES = 60;
import { evaluateIntake, evaluateDelivery } from "./deliveryPolicy";
import { getDeliveryMode, getDeliveryModeStatus } from "./deliveryMode";
import { recordAuditEvent } from "./auditLog";
import { TIERS } from "./agentProducts";
import { notifyAdminManualReview, notifyCustomerProcessingDelay, notifyAdminEscalation, notifyCustomerOrderFulfilled, notifyCustomerOrderSms, notifyCustomerOrderQueued, notifyAdminLowBalance, notifyAdminStaleQueued, notifyAdminHeldDigest, notifyAdminHeldUrgentSms } from "./notifications";
import { getAppSetting, setAppSetting, clearAppSetting } from "./appSettings";

// `source` decides what a CONFIRMED payment is allowed to lead to:
//   "event"   the customer's own verify call or a Paystack webhook: a payment
//             that is happening now. May become "ready" (automatic delivery),
//             but only if delivery mode is automatic and the checkout is fresh.
//   "review"  an outstanding-orders check or a manual "Verify with Paystack":
//             looks things up and records them, NEVER leads to delivery. A paid
//             order found this way is held in Needs attention.
//   "admin"   an admin's explicit approval (see approveAndDeliver): becomes
//             "ready" regardless of mode and age.
export async function verifyAndPrepareOrder(reference, { source = "event" } = {}) {
  const order = await getOrder(reference);
  if (!order) return { kind: "not_found" };
  if (order.fulfilled) return { kind: "fulfilled", order };

  let txn;
  try {
    txn = await verifyTransaction(reference);
  } catch (err) {
    if (!isUnknownReferenceError(err)) throw err;
    // Paystack has never seen this reference: the payment popup never opened.
    // Inside the grace period it may still be about to open; after that it is
    // an abandoned checkout and is closed (hidden from customers like the rest).
    const openMinutes = (Date.now() - new Date(order.createdAt).getTime()) / 60000;
    if (["pending", "payment_pending"].includes(order.status) && openMinutes > UNOPENED_CHECKOUT_GRACE_MINUTES) {
      const closed = await markPaymentFailed(reference, "payment_abandoned");
      return { kind: "failed", status: "payment_abandoned", order: closed };
    }
    return { kind: "payment_pending", status: "not_started", order };
  }
  if (txn.status !== "success") {
    const paymentStatus = String(txn.status || "").toLowerCase();
    const terminalPaymentFailure = new Set([
      "failed",
      "abandoned",
      "reversed",
      "cancelled",
      "canceled",
      "declined",
    ]).has(paymentStatus);

    if (terminalPaymentFailure) {
      // Customers' lists and the admin "Abandoned" filter recognise ONE code for a
      // checkout nobody paid: payment_abandoned. Recording Paystack's raw word
      // ("abandoned") made those checkouts show up as "Payment failed" orders.
      const failedOrder = await markPaymentFailed(reference, paymentStatus === "abandoned" ? "payment_abandoned" : (paymentStatus || "payment_failed"));
      return { kind: "failed", status: paymentStatus || "payment_failed", order: failedOrder };
    }

    const pendingOrder = await markPaymentPending(reference, paymentStatus || "pending");
    return { kind: "payment_pending", status: paymentStatus || "pending", order: pendingOrder };
  }

  // Is this REAL, LIVE money for THIS order? (test-mode "success", wrong reference)
  const genuine = assessPaystackPayment({ txn, reference });
  if (!genuine.ok) {
    console.error("Paystack payment rejected as not genuine", reference, genuine.code);
    const blocked = await markPaymentFailed(reference, genuine.code);
    await recordAuditEvent({ actor: "system", action: `payment_blocked_${genuine.code}`, reference, note: genuine.detail });
    return { kind: "failed", status: genuine.code, order: blocked };
  }

  if (String(txn.currency || "").toUpperCase() !== "GHS") {
    const info = {
      ...(readPaystackFees(txn) || {}),
      transactionId: readPaystackTransactionId(txn),
      paidAt: txn.paid_at || null,
    };
    const rejectedOrder = await markPaymentRejectedAfterCharge(reference, "currency_mismatch", Number(txn.amount), info);
    await recordAuditEvent({ actor: "system", action: "payment_charged_but_rejected", reference, note: `Paystack charged in ${txn.currency || "an unknown currency"}, expected GHS. The customer has been charged and nothing was delivered.` });
    return { kind: "failed", status: "currency_mismatch", order: rejectedOrder };
  }

  // With Paystack customer-fee pass-through enabled, the amount supplied by
  // PjDigitalServices is the service/product amount. Paystack adds its own
  // transaction fee to the customer's checkout total. Therefore the successful
  // transaction must cover the service amount, but must NOT be required to equal
  // our old fee-inclusive estimate.
  const serviceAmount = Number(
    PAYSTACK_PASS_FEES_TO_CUSTOMERS
      ? (order.customerProductAmount != null
        ? order.customerProductAmount
        : (order.checkoutAmount != null ? order.checkoutAmount : order.amount))
      : (order.checkoutAmount != null
        ? order.checkoutAmount
        : (order.customerProductAmount != null ? order.customerProductAmount : order.amount))
  );
  const expectedPesewas = Math.round(serviceAmount * 100);
  if (!Number.isFinite(expectedPesewas) || Number(txn.amount) < expectedPesewas) {
    const info = {
      ...(readPaystackFees(txn) || {}),
      transactionId: readPaystackTransactionId(txn),
      paidAt: txn.paid_at || null,
    };
    const rejectedOrder = await markPaymentRejectedAfterCharge(reference, "amount_mismatch", Number(txn.amount), info);
    await recordAuditEvent({
      actor: "system",
      action: "payment_charged_but_rejected",
      reference,
      note: `Paystack charged GHS ${(Number(txn.amount) / 100).toFixed(2)}, below the required service amount GHS ${(expectedPesewas / 100).toFixed(2)}. The customer has been charged and nothing was delivered.`,
    });
    return { kind: "failed", status: "amount_mismatch", order: rejectedOrder };
  }

  // Record what Paystack really charged and flag any order where we settle less
  // than the product price. Bookkeeping only: it must never block delivery.
  let feeInfo = null;
  try {
    feeInfo = readPaystackFees(txn);
    if (order.paystackFeeActual == null) {
      const assessment = assessPaystackFee(order, txn);
      if (["net_below_price", "fee_differs", "customer_overcharged_suspected"].includes(assessment.status)) {
        const note = describeFeeProblem(assessment);
        console.warn("Paystack fee check", reference, assessment.status, note);
        await recordAuditEvent({ actor: "system", action: `paystack_${assessment.status}`, reference, note });
      }
    }
  } catch (err) {
    console.error("Paystack fee check failed", reference, err.message);
  }

  const info = { ...(feeInfo || {}), transactionId: readPaystackTransactionId(txn), paidAt: txn.paid_at || null };

  // Evidence snapshot, written BEFORE any decision: what Paystack itself said about this
  // exact payment. If an order ever reaches Techlink without money, this is the record that
  // proves (or disproves) that Paystack confirmed it.
  await recordAuditEvent({
    actor: "system",
    action: "paystack_payment_confirmed",
    reference,
    note: `source=${source}; paystack_status=${txn.status}; domain=${txn.domain || "?"}; paystack_txn_id=${info.transactionId ?? "?"}; amount_pesewas=${txn.amount}; currency=${txn.currency || "?"}; paid_at=${txn.paid_at || "?"}; order_status_before=${order.status}/${order.fulfillmentStatus}`,
  });

  // The decision that protects the wallet: may this go to Techlink by itself?
  let hold = null;
  // Intake rules (mode, age, "found by a check") decide whether a payment may be
  // ACCEPTED. An order whose payment was already accepted (verified, queued with
  // Techlink, held for review...) must not be re-judged every time Paystack sends
  // a duplicate notification: that is a quiet no-op, exactly as before.
  const paymentNotYetAccepted = ["pending", "payment_pending", "payment_failed", "payment_rejected_after_charge"].includes(order.status);
  if (!paymentNotYetAccepted) {
    // fall through to markPaymentVerified, which only ever moves pending/failed/ready orders
  } else if (source === "review") {
    hold = { code: "reconciliation", message: "Paystack confirms this payment, but it was found by an outstanding-orders check. The app does not send orders to Techlink from a check; review it, then approve delivery." };
  } else if (source === "event") {
    const modeState = await getDeliveryModeStatus();
    // Unreadable setting: do NOT hold the order for manual approval over a blip.
    // Throwing makes the webhook job retry (and the customer's page say "checking
    // shortly"), and the order is picked up normally once the setting is readable.
    if (!modeState.known) throw new Error("Delivery mode could not be read; will retry");
    const decision = evaluateIntake({ order, mode: modeState.mode });
    if (!decision.allowed) hold = decision;
  }
  if (hold) {
    const held = await holdPaidOrderForReview(reference, { paymentAmount: txn.amount, info, note: hold.message });
    // Never report "held" unless the order really is held. A silent no-op here
    // would leave a paid customer with nothing delivered and nothing on the
    // Needs attention list; throwing makes the webhook job retry and alerts us.
    if (!held || held.fulfilled || held.fulfillmentStatus !== "manual_review") {
      throw new Error(`Paid order ${reference} could not be held for review (status ${held?.status}/${held?.fulfillmentStatus})`);
    }
    await recordAuditEvent({ actor: "system", action: "paid_order_held_for_approval", reference, note: `${hold.code}: ${hold.message}` });
    return { kind: "held", reason: hold.code, order: held };
  }

  const updated = await markPaymentVerified(reference, txn.amount, info);
  return { kind: "ready", order: updated };
}

// The Techlink docs we have show no example response for the bulk endpoints
// (the Postman page prints "No response body" for many endpoints that
// certainly do return data, so that is a missing example, NOT proof the
// endpoint returns nothing). The real response shape is therefore UNKNOWN,
// and the field names checked below are best guesses. A plain 2xx only proves
// the batch was ACCEPTED, not that every row was delivered. This looks for
// whatever per-row evidence a response happens to carry:
//   "partial_failure" — the response says some/all rows failed (unsafe to
//                       retry automatically: other rows may have gone through)
//   "confirmed"       — one entry per row and every one reports success
//   "unconfirmed"     — nothing to check (empty/unrecognised body)
export function assessBulkResult(result, expectedRows) {
  if (!result || typeof result !== "object") return { verdict: "unconfirmed" };
  const isFailed = (r) =>
    r && typeof r === "object" &&
    (r.success === false || Boolean(r.error) ||
      ["failed", "error", "rejected", "cancelled", "canceled", "declined"].includes(String(r.status || "").toLowerCase()));
  const isOk = (r) =>
    r && typeof r === "object" &&
    (r.success === true || ["success", "successful", "completed", "delivered"].includes(String(r.status || "").toLowerCase()));

  const failures = [];
  for (const key of ["failed", "failedCount", "failures", "failedOrders"]) {
    const v = result[key];
    if (typeof v === "number" && v > 0) failures.push(`${key}=${v}`);
    if (Array.isArray(v) && v.length > 0) failures.push(`${key}: ${v.length} row(s)`);
  }
  if (Array.isArray(result.errors) && result.errors.length > 0) failures.push(`errors: ${result.errors.length}`);

  const rowsKey = ["results", "orders", "items", "rows", "data"].find((k) => Array.isArray(result[k]));
  const rows = rowsKey ? result[rowsKey] : null;
  if (rows) {
    const bad = rows.filter(isFailed).length;
    if (bad > 0) failures.push(`${bad} of ${rows.length} rows failed`);
  }
  if (failures.length) return { verdict: "partial_failure", detail: failures.join("; ") };
  if (rows && rows.length > 0 && rows.length === expectedRows && rows.every(isOk)) return { verdict: "confirmed" };
  return { verdict: "unconfirmed" };
}

// `approvedBy` is set ONLY when a named admin explicitly decided to send this
// order (Approve & deliver, Send now, Mark paid & send, Accept charged). The
// background worker never sets it, so it can never deliver an order that fails
// the delivery policy.
export async function fulfillClaimedOrder(reference, { approvedBy = null } = {}) {
  // Read the delivery mode BEFORE claiming, so a read failure leaves the order
  // exactly as it was ("ready") for the next cycle instead of stranding it.
  const modeState = await getDeliveryModeStatus();
  if (!modeState.known && !approvedBy) return { kind: "deferred", reason: "delivery_mode_unreadable" };
  // A Techlink TEST key must never carry real customer orders: Techlink may answer
  // with a simulation and deliver nothing. Nothing is sent and the order stays
  // "ready", so it delivers on its own as soon as a live key is set. An admin's
  // approval cannot change this: a test key cannot deliver real goods either way.
  if (isStrict() && techlinkKeyMode() === "test") return { kind: "deferred", reason: "techlink_test_key_in_production" };
  const claim = await claimFulfillment(reference);
  if (!claim) {
    const current = await getOrder(reference);
    if (!current) return { kind: "not_found" };
    if (current.fulfilled) return { kind: "fulfilled", order: current };
    if (current.fulfillmentStatus === "processing") return { kind: "processing", order: current };
    return { kind: "not_ready", order: current };
  }

  // Last-mile check, right before wallet money is spent. Everything above can
  // be bypassed by a stray database write; this cannot.
  const gate = evaluateDelivery({ order: claim, mode: modeState.mode, approvedBy });
  if (!gate.allowed) {
    const held = await markHeldForManualReview(reference, { failReason: "held_for_approval", error: gate.message });
    await recordAuditEvent({ actor: "system", action: "delivery_blocked_by_policy", reference, note: `${gate.code}: ${gate.message}` });
    return { kind: "held", reason: gate.code, order: held };
  }

  // Written BEFORE the Techlink call, so even a crash mid-call leaves a record of who or what
  // sent the order and on what payment evidence.
  await recordAuditEvent({
    actor: approvedBy || "system",
    action: "sent_to_techlink",
    reference,
    note: `${approvedBy ? `approved by ${approvedBy}` : "automatic"}; delivery_mode=${modeState.mode}; paystack_txn_id=${claim.paystackTransactionId || "none"}; payment_amount_pesewas=${claim.paymentAmount ?? "none"}; payment_verified_at=${claim.paymentVerifiedAt || "none"}`,
  });

  try {
    const result = await fulfillOrder(claim);

    // Techlink's documentation says a test-key call returns a SIMULATED response that
    // carries "testMode": true and delivers nothing. Never call that "delivered" on the
    // live site: the customer has paid and received nothing.
    if (result?.testMode === true && isStrict()) {
      const error = "Techlink answered this order in TEST MODE, so nothing was delivered. Check TECHLINK_API_KEY (it must start tlg_live_), then use Approve & deliver to send it for real.";
      const held = await markHeldForManualReview(reference, { failReason: "techlink_test_mode", error, result });
      await recordAuditEvent({ actor: "system", action: "techlink_test_mode_response", reference, note: error });
      return { kind: "manual_review", order: held, error };
    }

    // A voucher purchase must come back with the vouchers. The customer paid for specific
    // serial numbers and PINs; "success" without them is not a delivery, and telling the
    // customer "delivered" would leave them with nothing.
    if (isVoucherOrder(claim) && !vouchersComplete(result, claim.checkerDetails?.quantity)) {
      const error = `Techlink reported success but returned fewer voucher serial/PIN pairs than the ${Number(claim.checkerDetails?.quantity) || 1} bought. The customer has NOT been told it was delivered. Find the vouchers in Techlink (GET /result-checker/my), send them to the customer, then mark the order delivered.`;
      const held = await markHeldForManualReview(reference, { failReason: "voucher_missing", error, result });
      await recordAuditEvent({ actor: "system", action: "voucher_details_missing", reference, note: error });
      return { kind: "manual_review", order: held, error };
    }

    const tierKey = claim.tierDetails?.tierKey;
    // BUG FIX: this used to only check orderType === "tierData", so a BULK
    // or Excel order for a non-instant tier (currently MTN Master — see
    // TIERS.mtnMaster.instant in lib/agentProducts.js) skipped the queued
    // state entirely and went straight to "fulfilled" with a "Delivered!"
    // customer email/SMS, for the exact same reason this was already fixed
    // for single tierData orders (see the comment on markQueuedWithProvider
    // in lib/store.js). components/TierShop.js lets a customer run MTN
    // Master through Single, Bulk, or Excel mode, so all three needed the
    // same non-instant handling, not just Single.
    const isTierOrder = claim.orderType === "tierData" || claim.orderType === "tierBulkData";
    const isDelayedTier = isTierOrder && TIERS[tierKey]?.instant === false;

    // Bulk batches: a 2xx only means "accepted". If the response itself says
    // some rows failed, hold the order for a human (retrying resubmits the
    // whole batch and would double-deliver the rows that worked). If it says
    // nothing either way (the response shape is unknown) we can't honestly
    // call it delivered, so it waits in "queued" for confirmation — unless
    // BULK_AUTO_CONFIRM=true opts back in to trusting the 2xx.
    const isBulkOrder = claim.orderType === "tierBulkData" || claim.orderType === "tierBulkAirtime";
    let holdUnconfirmedBulk = false;
    if (isBulkOrder) {
      const bulk = assessBulkResult(result, claim.tierDetails?.rows?.length || 0);
      if (bulk.verdict === "partial_failure") {
        const held = await markHeldForManualReview(reference, {
          failReason: "bulk_partial_failure",
          error: `Techlink reported a problem with this bulk batch (${bulk.detail}). Some rows may already have been delivered — verify each recipient with Techlink BEFORE retrying, because a retry resubmits the whole batch.`,
          result,
        });
        return { kind: "manual_review", order: held, error: bulk.detail };
      }
      holdUnconfirmedBulk = bulk.verdict === "unconfirmed" && process.env.BULK_AUTO_CONFIRM !== "true";
    }

    if (isDelayedTier || holdUnconfirmedBulk) {
      const queued = await markQueuedWithProvider(reference, result);
      try {
        await notifyCustomerOrderQueued(queued);
      } catch (err) {
        console.error("Customer queued notification failed", reference, err);
      }
      return { kind: "queued", order: queued };
    }

    const updated = await markFulfilled(reference, result);
    // Best-effort: a notification failure here must never undo or block the
    // fulfillment that already succeeded — the order stays delivered either way.
    // Email and SMS are independent channels — one failing (e.g. Brevo balance,
    // bad number) must never block the other from being attempted.
    try {
      await notifyCustomerOrderFulfilled(updated);
    } catch (err) {
      console.error("Customer delivery confirmation (email) failed", reference, err);
    }
    try {
      await notifyCustomerOrderSms(updated);
    } catch (err) {
      console.error("Customer delivery confirmation (SMS) failed", reference, err);
    }
    return { kind: "fulfilled", order: updated };
  } catch (err) {
    // Ambiguous outcome (timeout / dropped connection / 5xx): Techlink may
    // already have delivered and debited. Do NOT make this order retryable —
    // hold it for a human to confirm, then confirm_fulfilled or retry.
    // The notification loop in recoverAndListReadyOrders picks it up next run.
    if (err?.ambiguous) {
      const held = await markFulfillmentAmbiguous(reference, err.message);
      return { kind: "manual_review", order: held, error: err.message };
    }
    const updated = await markFulfillmentFailed(reference, err.message);
    return { kind: "retryable_failure", order: updated, error: err.message };
  }
}

// Re-checks a "queued_with_provider" order directly with Techlink. Called
// lazily — whenever a customer or admin actually looks at the order — as a
// backstop between scheduled runs of /api/jobs/fulfill. Safe to call on any
// order: does nothing unless the order is actually in the queued state.
export async function checkQueuedOrder(reference) {
  const order = await getOrder(reference);
  if (!order || order.fulfillmentStatus !== "queued_with_provider") return order;
  const orderId = order.result?.orderId;
  // A queued BULK tier order only has an orderId here if Techlink's bulk
  // response returned one. Whether it does is not established by the docs we
  // have (they show no example response), so treat "no orderId" as "cannot
  // auto-resolve": it needs the admin "Mark fulfilled manually" action
  // (pages/admin/index.js "Queued with provider" panel) once delivery is
  // confirmed with Techlink. Check the stored `result` of a real bulk order to
  // see what Techlink actually returns.
  if (!orderId) return order;

  try {
    const verification = await verifyOrderStatus(orderId);
    if (verification?.status === "completed") {
      const finalized = await finalizeQueuedOrder(reference, verification);
      if (finalized) {
        try {
          await notifyCustomerOrderFulfilled(finalized);
        } catch (err) {
          console.error("Customer delivery confirmation (email) failed", reference, err);
        }
        try {
          await notifyCustomerOrderSms(finalized);
        } catch (err) {
          console.error("Customer delivery confirmation (SMS) failed", reference, err);
        }
        return finalized;
      }
    } else if (verification?.status === "failed" || verification?.status === "cancelled") {
      const failed = await markQueuedOrderFailed(reference, verification?.message || `Provider status: ${verification?.status}`);
      if (failed) return failed;
    }
  } catch (err) {
    // A failed CHECK (e.g. Techlink temporarily unreachable) must never
    // change the order's own state — it just stays queued and gets
    // checked again next time someone looks.
    console.error("Queued-order verification check failed", reference, err.message);
  }
  return order;
}

export async function checkQueuedOrders(limit = 20) {
  // Queued BULK tier orders have no provider orderId (Techlink's bulk
  // endpoint returns no body), so checkQueuedOrder can never resolve them.
  // Oldest-first + a plain limit meant a handful of those permanently
  // filled every run's batch and starved newer, checkable orders. Only
  // orders that can actually be verified belong in the batch.
  const candidates = await listQueuedOrders(Math.max(limit * 10, 200));
  const queued = candidates.filter((o) => o.result?.orderId).slice(0, limit);
  const results = [];
  for (const order of queued) {
    const before = order.fulfillmentStatus;
    try {
      const updated = await checkQueuedOrder(order.reference);
      results.push({
        reference: order.reference,
        before,
        status: updated?.fulfillmentStatus || before,
        fulfilled: Boolean(updated?.fulfilled),
      });
    } catch (err) {
      console.error("Queued-order worker check failed", order.reference, err.message);
      results.push({ reference: order.reference, before, status: before, fulfilled: false, error: err.message });
    }
  }
  return results;
}

// BUG FIX: this used to take no parameters at all, so the caller in
// pages/api/jobs/fulfill.js was passing FULFILLMENT_BATCH_SIZE in here
// for nothing — it was silently dropped, and every call fell through to
// the hardcoded default limit of 20 in recoverStaleProcessingOrders(),
// promoteExhaustedFailedOrders(), and listReadyOrders() in lib/store.js.
// A deployment that configured FULFILLMENT_BATCH_SIZE above 20 (a
// reasonable thing to do on a busier store) was actually capped at 20
// ready/stale/exhausted orders per worker run regardless of that setting.
export async function recoverAndListReadyOrders(limit = 20) {
  const staleRecovered = await recoverStaleProcessingOrders(Number(process.env.FULFILLMENT_STALE_MINUTES || 30), limit);
  // Two different roads into "manual_review", both handled identically from
  // here on: orders that got stuck mid-processing (a crash/timeout), and
  // orders that failed outright and exhausted their automatic retries (see
  // promoteExhaustedFailedOrders in store.js for why this second path
  // matters — without it, a run of clean failures, e.g. an empty Techlink
  // wallet, never paged anyone).
  const { promoteExhaustedFailedOrders } = await import("./store");
  const exhaustedPromoted = await promoteExhaustedFailedOrders(limit);
  // Plus anything already sitting in manual_review that hasn't been
  // escalated yet (includes ambiguous-outcome orders held by
  // fulfillClaimedOrder). De-duplicated by reference.
  const awaiting = await listManualReviewAwaitingEscalation(50);
  const seen = new Set();
  const recovered = [...staleRecovered, ...exhaustedPromoted, ...awaiting].filter((o) => {
    if (seen.has(o.reference)) return false;
    seen.add(o.reference);
    return true;
  });
  // Orders the app deliberately held for approval are a QUEUE: they get one digest, not
  // an email + two SMS each. Real incidents (a Techlink failure) keep per-order alerts.
  const isHeldForApproval = (o) => o.failReason === "held_for_approval";
  const heldOrders = recovered.filter(isHeldForApproval);
  for (const order of recovered.filter((o) => !isHeldForApproval(o))) {
    try {
      const pending = await markManualReviewNotified(order.reference);
      if (pending) {
        const sent = await notifyAdminManualReview(pending);
        if (sent?.sent) await recordManualReviewNotified(order.reference);
      }
    } catch (err) {
      console.error("Admin stale-order notification failed", order.reference, err);
    }
    try {
      const pending = await markCustomerDelayNotified(order.reference);
      if (pending) {
        const sent = await notifyCustomerProcessingDelay(pending);
        if (sent?.sent) await recordCustomerDelayNotified(order.reference);
      }
    } catch (err) {
      console.error("Customer delay notification failed", order.reference, err);
    }
    const elapsedMinutes = order.manualReviewAt ? (Date.now() - new Date(order.manualReviewAt).getTime()) / 60000 : 0;
    if (elapsedMinutes >= Number(process.env.URGENT_REVIEW_MINUTES || 30) && !order.urgentReviewNotifiedAt) {
      // Each channel is tried and caught independently: a Brevo SMS failure
      // (e.g. bad number, low balance) must not prevent the email escalation
      // from still going out, and vice versa.
      let sent = false;
      if (process.env.ADMIN_SMS_TO && process.env.BREVO_API_KEY) {
        try {
          const result = await notifyAdminEscalation(order, "sms");
          sent = Boolean(result?.sent) || sent;
        } catch (err) {
          console.error("Admin SMS escalation failed", order.reference, err);
        }
      }
      if (process.env.ADMIN_ALERT_EMAIL && process.env.RESEND_API_KEY) {
        try {
          const result = await notifyAdminEscalation(order, "email");
          sent = Boolean(result?.sent) || sent;
        } catch (err) {
          console.error("Admin email escalation failed", order.reference, err);
        }
      }
      if (sent) {
        try {
          await recordUrgentReviewNotified(order.reference);
        } catch (err) {
          console.error("Failed to record urgent review notification", order.reference, err);
        }
      }
    }
  }

  // ---- held-for-approval queue: one digest, one urgent digest ----
  if (heldOrders.length) {
    const newlyHeld = [];
    for (const order of heldOrders) {
      try {
        const pending = await markManualReviewNotified(order.reference);
        if (pending) newlyHeld.push(pending);
      } catch (err) {
        console.error("Held-order check failed", order.reference, err);
      }
      try {
        // Each waiting customer still gets one honest notice that their order is being reviewed.
        const pending = await markCustomerDelayNotified(order.reference);
        if (pending) {
          const sent = await notifyCustomerProcessingDelay(pending);
          if (sent?.sent) await recordCustomerDelayNotified(order.reference);
        }
      } catch (err) {
        console.error("Customer delay notification failed", order.reference, err);
      }
    }
    // Orders already past the urgent threshold are covered by ONE urgent digest, which also
    // counts as their first notice; only the rest get the ordinary "new" digest.
    const urgentHours = Number(process.env.HELD_URGENT_HOURS || 4);
    const overdue = heldOrders.filter((o) => !o.urgentReviewNotifiedAt && o.manualReviewAt && (Date.now() - new Date(o.manualReviewAt).getTime()) / 3600000 >= urgentHours);
    const overdueRefs = new Set(overdue.map((o) => o.reference));
    const fresh = newlyHeld.filter((o) => !overdueRefs.has(o.reference));

    if (fresh.length) {
      try {
        const sent = await notifyAdminHeldDigest(fresh);
        if (sent?.sent) for (const o of fresh) await recordManualReviewNotified(o.reference);
      } catch (err) {
        console.error("Held-order digest failed", err);
      }
    }
    if (overdue.length) {
      let sent = false;
      try { sent = Boolean((await notifyAdminHeldDigest(overdue, { urgent: true }))?.sent) || sent; } catch (err) { console.error("Urgent held digest (email) failed", err); }
      try { sent = Boolean((await notifyAdminHeldUrgentSms(overdue))?.sent) || sent; } catch (err) { console.error("Urgent held digest (SMS) failed", err); }
      if (sent) {
        for (const o of overdue) {
          try { await recordManualReviewNotified(o.reference); await recordUrgentReviewNotified(o.reference); } catch (err) { console.error("Failed to record urgent notification", o.reference, err); }
        }
      }
    }
  }

  const { listReadyOrders } = await import("./store");
  return listReadyOrders(limit);
}

export async function verifyAndFulfillOrder(reference) {
  const prepared = await verifyAndPrepareOrder(reference, { source: "event" });
  if (prepared.kind !== "ready" && prepared.kind !== "fulfilled") return prepared;
  if (prepared.kind === "fulfilled") return prepared;
  return fulfillClaimedOrder(reference);
}

// An admin's decision after looking at an order: re-check the payment with
// Paystack right now, then send it. This is the ONLY road from "found by a check"
// or "held for approval" to Techlink.
export async function approveAndDeliver(reference, { approvedBy }) {
  if (!approvedBy) throw new Error("An approving admin is required");
  const order = await getOrder(reference);
  if (!order) return { kind: "not_found" };
  if (order.fulfilled) return { kind: "fulfilled", order };

  const txn = await verifyTransaction(reference);
  if (String(txn.status).toLowerCase() !== "success") {
    return { kind: "rejected", code: "not_paid", message: `Paystack reports this payment as "${txn.status}". Nothing was sent.` };
  }
  const genuine = assessPaystackPayment({ txn, reference });
  if (!genuine.ok) return { kind: "rejected", code: genuine.code, message: genuine.detail };
  if (String(txn.currency || "").toUpperCase() !== "GHS") return { kind: "rejected", code: "currency_mismatch", message: `Paystack took ${txn.currency || "an unknown currency"}, not GHS. Nothing was sent.` };
  const serviceAmount = Number(order.customerProductAmount != null
    ? order.customerProductAmount
    : (order.checkoutAmount != null ? order.checkoutAmount : order.amount));
  const expectedGrossAmount = serviceAmount;
  const expected = Math.round(expectedGrossAmount * 100);
  if (Number(txn.amount) < expected) {
    return { kind: "rejected", code: "underpaid", message: `Paystack took GHS ${(Number(txn.amount) / 100).toFixed(2)} but the order costs GHS ${(expected / 100).toFixed(2)}. Nothing was sent.` };
  }

  const info = { ...(readPaystackFees(txn) || {}), transactionId: readPaystackTransactionId(txn), paidAt: txn.paid_at || null };
  if (order.fulfillmentStatus === "manual_review") {
    // Already verified and held: the admin's approval releases it.
    await manuallyResolveOrder(reference, "retry", `Approved by ${approvedBy} after re-checking Paystack`);
  } else {
    await markPaymentVerified(reference, txn.amount, info);
  }
  return fulfillClaimedOrder(reference, { approvedBy });
}

// Proactive counterpart to the reactive manual_review/urgent-escalation
// path above. That path only ever finds out about a dry Techlink wallet
// AFTER an order has already failed and exhausted its retries — by which
// point a customer has already been charged by Paystack with nothing
// delivered (the exact incident this was built for). This checks the
// wallet balance directly, on every /api/jobs/fulfill run (every 5
// minutes, see .github/workflows/background-worker.yml), and alerts BEFORE that happens.
//
// The cooldown (via app_settings — see lib/appSettings.js) exists so a
// balance that's been low for hours doesn't re-alert every single 5-minute
// run; TECHLINK_LOW_BALANCE_ALERT_COOLDOWN_HOURS controls that window.
// Once the balance recovers above the threshold, the stored marker is
// cleared so the NEXT dip alerts immediately rather than waiting out a
// stale cooldown from a previous, unrelated low-balance period.
//
// Never throws outward — a failure to check or alert about the balance
// must never fail the fulfillment run itself.
const LOW_BALANCE_SETTING_KEY = "techlink_low_balance_last_alert_at";

export async function checkTechlinkWalletBalance() {
  const threshold = Number(process.env.TECHLINK_LOW_BALANCE_THRESHOLD || 200);
  const cooldownHours = Number(process.env.TECHLINK_LOW_BALANCE_ALERT_COOLDOWN_HOURS || 6);
  try {
    const data = await getWalletBalance();
    // Same defensive field-name handling as pages/api/admin/wallet-balance.js
    // — the Postman docs don't show a response body for this endpoint.
    const balance = data?.balance ?? data?.walletBalance ?? data?.newBalance ?? null;
    if (balance == null) {
      console.error("Techlink wallet balance check: unrecognized response shape", data);
      return { checked: false, reason: "unrecognized_response" };
    }

    if (Number(balance) >= threshold) {
      // Balance is healthy again — clear any stale cooldown marker so a
      // future dip alerts right away instead of possibly being suppressed
      // by a cooldown window left over from this earlier low period.
      try {
        const marker = await getAppSetting(LOW_BALANCE_SETTING_KEY);
        if (marker) await clearAppSetting(LOW_BALANCE_SETTING_KEY);
      } catch (err) {
        console.error("Failed to clear low-balance alert marker", err.message);
      }
      return { checked: true, balance: Number(balance), low: false };
    }

    const lastAlertAt = await getAppSetting(LOW_BALANCE_SETTING_KEY);
    const cooldownMs = cooldownHours * 60 * 60 * 1000;
    const dueForAlert = !lastAlertAt || (Date.now() - new Date(lastAlertAt).getTime()) >= cooldownMs;
    let alerted = false;
    if (dueForAlert) {
      try {
        const result = await notifyAdminLowBalance(balance, threshold);
        alerted = Boolean(result?.sent);
        if (!alerted) console.error("Low-balance alert reached no channel", result?.errors || "not configured");
      } catch (err) {
        console.error("Low-balance admin alert failed to send", err.message);
      }
      // Start the cooldown ONLY if an alert actually went out. Recording a
      // failed/unconfigured attempt would silence the alert for the whole
      // cooldown window — exactly when the wallet is empty. A persistent
      // failure retries each cron run (5 min), which is the desired
      // behaviour for a page that hasn't reached anyone yet; duplicate
      // sends within an hour are prevented by the per-channel idempotency
      // keys in notifyAdminLowBalance.
      if (alerted) {
        try {
          await setAppSetting(LOW_BALANCE_SETTING_KEY, new Date().toISOString());
        } catch (err) {
          console.error("Failed to record low-balance alert timestamp", err.message);
        }
      }
    }
    return { checked: true, balance: Number(balance), low: true, alerted };
  } catch (err) {
    console.error("Techlink wallet balance check failed", err.message);
    return { checked: false, reason: err.message };
  }
}


// Alerts the admin once per order when a queued order has waited longer than
// QUEUED_ALERT_MINUTES (default 180). Runs on every /api/jobs/fulfill call.
// Never throws outward. If no channel could deliver the alert, the claim is
// released so the next run tries again instead of silently giving up.
export async function alertStaleQueuedOrders() {
  const minutes = Number(process.env.QUEUED_ALERT_MINUTES || 180);
  try {
    const claimed = await claimStaleQueuedAlerts(minutes, 20);
    let alerted = 0;
    for (const order of claimed) {
      let delivered = false;
      try {
        const res = await notifyAdminStaleQueued(order, minutes);
        delivered = Boolean(res?.sent);
        if (!delivered) console.error("Stale-queued alert reached no channel", order.reference, res?.errors || "not configured");
      } catch (err) {
        console.error("Stale-queued alert failed", order.reference, err.message);
      }
      if (delivered) alerted += 1;
      else {
        try { await releaseQueuedAlert(order.reference); } catch (err) { console.error("Failed to release queued-alert claim", order.reference, err.message); }
      }
    }
    return { checked: true, stale: claimed.length, alerted };
  } catch (err) {
    console.error("Stale queued-order check failed", err.message);
    return { checked: false, reason: err.message };
  }
}


/* ---------------- Recovery tools used by the worker and the dashboard ---------------- */

// A checkout that never got confirmed is either abandoned OR paid-but-missed
// (customer closed the tab, status check failed, webhook lost). Nothing used to
// re-check them automatically — they waited for a person to spot them. This
// asks Paystack about each one: paid ones become "ready" and are delivered by
// the normal worker step; abandoned ones are closed. It only PREPARES (verify
// with Paystack); delivery stays in the existing, claim-protected step.
// The OUTSTANDING-ORDERS CHECK. Looks at checkouts still marked unpaid, asks
// Paystack about each, and records what it finds:
//   paid      -> held in Needs attention for an admin decision  (paidHeld)
//   abandoned -> closed                                          (closed)
//   still open-> left alone                                      (stillPending)
//   wrong amount / not genuine -> flagged                        (rejected)
// It NEVER sends anything to Techlink, so `deliveries` is always 0. This used to
// verify with Paystack and then deliver on its own; that is how orders nobody
// had authorised reached Techlink.
export async function sweepStalePendingOrders({ limit = 10, olderThanMinutes = 10, newerThanDays = 7, deadline = null } = {}) {
  const candidates = await listStalePendingOrders({ olderThanMinutes, newerThanDays, limit });
  const summary = { checked: 0, paidHeld: 0, closed: 0, stillPending: 0, rejected: 0, errors: 0, deliveries: 0 };
  for (const candidate of candidates) {
    if (deadline && Date.now() > deadline) { summary.truncated = true; break; }
    summary.checked += 1;
    try {
      const result = await verifyAndPrepareOrder(candidate.reference, { source: "review" });
      if (result.kind === "held") summary.paidHeld += 1;
      else if (result.kind === "fulfilled") summary.closed += 1;
      else if (result.kind === "payment_pending") summary.stillPending += 1;
      else if (result.kind === "failed" && ["amount_mismatch", "currency_mismatch", ...NOT_REAL_PAYMENT_CODES].includes(result.status)) summary.rejected += 1;
      else summary.closed += 1;
    } catch (err) {
      summary.errors += 1;
      console.error("Outstanding-orders check failed for", candidate.reference, err);
    }
  }
  return summary;
}

// Live look at what Paystack actually took for an order we rejected.
export async function inspectChargedOrder(reference) {
  const order = await getOrder(reference);
  if (!order) return { verdict: "not_found" };
  const txn = await verifyTransaction(reference);
  const serviceAmount = Number(order.customerProductAmount != null
    ? order.customerProductAmount
    : (order.checkoutAmount != null ? order.checkoutAmount : order.amount));
  const expected = serviceAmount;
  const paid = Number(txn.amount) / 100;
  let verdict = "acceptable";
  if (String(txn.status).toLowerCase() !== "success") verdict = "not_paid";
  else if (!assessPaystackPayment({ txn, reference }).ok) verdict = "not_real_payment";
  else if (txn.currency && txn.currency !== "GHS") verdict = "wrong_currency";
  else if (Math.round(paid * 100) < Math.round(expected * 100)) verdict = "underpaid";
  return {
    verdict,
    paystackStatus: String(txn.status || ""),
    currency: txn.currency || "GHS",
    paid: Math.round(paid * 100) / 100,
    expected: Math.round(expected * 100) / 100,
    difference: Math.round((paid - expected) * 100) / 100,
    order,
    txn,
  };
}

// Admin decision: the customer paid at least what the order costs, so honour
// it. Re-checks Paystack itself and never trusts the browser.
export async function acceptChargedOrder(reference, { approvedBy = "admin" } = {}) {
  const inspected = await inspectChargedOrder(reference);
  if (inspected.verdict === "not_found") throw new Error("Unknown order");
  if (inspected.verdict !== "acceptable") {
    const reasons = {
      not_paid: "Paystack does not show this payment as successful.",
      wrong_currency: "The payment was not taken in GHS.",
      not_real_payment: "Paystack does not show this as a real live payment (test mode or a different reference).",
      underpaid: `The customer paid GHS ${inspected.paid.toFixed(2)} but the order costs GHS ${inspected.expected.toFixed(2)}. Refund it or collect the difference; it cannot be sent.`,
    };
    throw new Error(reasons[inspected.verdict] || "This payment cannot be accepted.");
  }
  if (inspected.order.fulfilled) return { kind: "fulfilled", order: inspected.order };
  const paidPesewas = Math.round(inspected.paid * 100);
  const verified = await markPaymentVerified(reference, paidPesewas, { ...(readPaystackFees(inspected.txn) || {}), transactionId: readPaystackTransactionId(inspected.txn), paidAt: inspected.txn?.paid_at || null });
  if (!verified || verified.status !== "payment_verified") throw new Error("The order could not be moved to verified. Check its current state.");
  return fulfillClaimedOrder(reference, { approvedBy });
}

// Evidence from Techlink's own history about one of our orders. Never throws:
// a lookup failure is reported as "unknown", which must not block an admin.
export async function checkTechlinkEvidence(order, { claimedOrderIds = new Set() } = {}) {
  try {
    const since = new Date(new Date(order.paymentVerifiedAt || order.createdAt || Date.now()).getTime() - 15 * 60_000).toISOString();
    const history = await fetchRecentTechlinkOrders({ maxPages: 3, limit: 100, stopBefore: since });
    return assessTechlinkEvidence(order, history.rows, { exhausted: history.exhausted, oldestFetchedAt: history.oldestFetchedAt, claimedOrderIds });
  } catch (err) {
    console.error("Techlink evidence lookup failed", order?.reference, err.message);
    return { verdict: "unknown", matches: [], note: `Could not load Techlink's order history (${err.message}). Check Techlink directly.` };
  }
}
