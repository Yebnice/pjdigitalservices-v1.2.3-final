import { verifyTransaction } from "./paystack";
import {
  getOrder,
  markFailed,
  markPaymentVerified,
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
} from "./store";
import { fulfillOrder, verifyOrderStatus, getWalletBalance } from "./techlink";
import { TIERS } from "./agentProducts";
import { notifyAdminManualReview, notifyCustomerProcessingDelay, notifyAdminEscalation, notifyCustomerOrderFulfilled, notifyCustomerOrderSms, notifyCustomerOrderQueued, notifyAdminLowBalance, notifyAdminStaleQueued } from "./notifications";
import { getAppSetting, setAppSetting, clearAppSetting } from "./appSettings";

export async function verifyAndPrepareOrder(reference) {
  const order = await getOrder(reference);
  if (!order) return { kind: "not_found" };
  if (order.fulfilled) return { kind: "fulfilled", order };

  const txn = await verifyTransaction(reference);
  if (txn.status !== "success") {
    await markFailed(reference, txn.status);
    return { kind: "failed", status: txn.status };
  }

  if (txn.currency && txn.currency !== "GHS") {
    await markFailed(reference, "currency_mismatch");
    return { kind: "failed", status: "currency_mismatch" };
  }

  // Customers are charged amount + the Paystack fee markup (checkoutAmount),
  // never the bare product amount — see pages/api/orders/create.js. That's
  // what Paystack actually processes and what must be verified here.
  // Fallback to `amount` only for orders created before this field existed
  // (in-flight at deploy time), so they can still verify correctly.
  const expectedTotal = order.checkoutAmount != null ? order.checkoutAmount : order.amount;
  const expectedPesewas = Math.round(expectedTotal * 100);
  if (Number(txn.amount) !== expectedPesewas) {
    await markFailed(reference, "amount_mismatch");
    return { kind: "failed", status: "amount_mismatch" };
  }

  const updated = await markPaymentVerified(reference, txn.amount);
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

export async function fulfillClaimedOrder(reference) {
  const claim = await claimFulfillment(reference);
  if (!claim) {
    const current = await getOrder(reference);
    if (!current) return { kind: "not_found" };
    if (current.fulfilled) return { kind: "fulfilled", order: current };
    if (current.fulfillmentStatus === "processing") return { kind: "processing", order: current };
    return { kind: "not_ready", order: current };
  }

  try {
    const result = await fulfillOrder(claim);
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
  const staleRecovered = await recoverStaleProcessingOrders(Number(process.env.FULFILLMENT_STALE_MINUTES || 10), limit);
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
  for (const order of recovered) {
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
  const { listReadyOrders } = await import("./store");
  return listReadyOrders(limit);
}

export async function verifyAndFulfillOrder(reference) {
  const prepared = await verifyAndPrepareOrder(reference);
  if (prepared.kind !== "ready" && prepared.kind !== "fulfilled") return prepared;
  if (prepared.kind === "fulfilled") return prepared;
  return fulfillClaimedOrder(reference);
}

// Proactive counterpart to the reactive manual_review/urgent-escalation
// path above. That path only ever finds out about a dry Techlink wallet
// AFTER an order has already failed and exhausted its retries — by which
// point a customer has already been charged by Paystack with nothing
// delivered (the exact incident this was built for). This checks the
// wallet balance directly, on every /api/jobs/fulfill run (every 5
// minutes, see vercel.json), and alerts BEFORE that happens.
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
