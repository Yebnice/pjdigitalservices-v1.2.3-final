import { getSupabase } from "./supabaseClient";

function fromRow(row) {
  return {
    reference: row.reference,
    orderType: row.order_type,
    network: row.network,
    phone: row.phone,
    email: row.email,
    amount: Number(row.amount),
    providerCost: row.provider_cost == null ? Number(row.amount) : Number(row.provider_cost),
    checkoutAmount: row.checkout_amount == null ? null : Number(row.checkout_amount),
    paystackFeeAmount: row.paystack_fee_amount == null ? null : Number(row.paystack_fee_amount),
    customerProductAmount: row.customer_product_amount == null ? null : Number(row.customer_product_amount),
    businessMarkupAmount: row.business_markup_amount == null ? null : Number(row.business_markup_amount),
    idempotencyKey: row.idempotency_key || null,
    bundleId: row.bundle_id,
    afaDetails: row.afa_details,
    meterNumber: row.meter_number,
    tvDetails: row.tv_details,
    checkerDetails: row.checker_details,
    tierDetails: row.tier_details,
    status: row.status,
    fulfilled: row.fulfilled,
    fulfillmentStatus: row.fulfillment_status || (row.fulfilled ? "fulfilled" : "pending"),
    fulfillmentAttempts: Number(row.fulfillment_attempts || 0),
    processingStartedAt: row.processing_started_at,
    lastFulfillmentError: row.last_fulfillment_error,
    paymentVerifiedAt: row.payment_verified_at,
    paymentAmount: row.payment_amount == null ? null : Number(row.payment_amount),
    result: row.result,
    failReason: row.fail_reason,
    createdAt: row.created_at,
    fulfilledAt: row.fulfilled_at,
    manualReviewNotifiedAt: row.manual_review_notified_at,
    customerDelayNotifiedAt: row.customer_delay_notified_at,
    manualReviewResolution: row.manual_review_resolution,
    manualReviewResolvedAt: row.manual_review_resolved_at,
    manualReviewAt: row.manual_review_at,
    urgentReviewNotifiedAt: row.urgent_review_notified_at,
    queuedAlertSentAt: row.queued_alert_sent_at,
  };
}


function sanitizePublicResult(result) {
  if (result == null) return null;
  if (typeof result !== "object") return String(result).slice(0, 500);
  const allowed = ["token", "units", "reference", "transactionId", "message", "status", "customerName", "package", "amount", "amountDue"];
  const out = {};
  for (const key of allowed) {
    if (result[key] != null) out[key] = result[key];
  }
  return out;
}

function publicFailure(order) {
  if (order.fulfillmentStatus === "failed") return "We could not complete this order. Please contact support with your order reference.";
  return null;
}

export function toPublicOrder(order) {
  if (!order) return null;
  return {
    reference: order.reference,
    orderType: order.orderType,
    network: order.network,
    amount: order.amount,
    checkoutAmount: order.checkoutAmount,
    paystackFeeAmount: order.paystackFeeAmount,
    customerProductAmount: order.customerProductAmount,
    status: order.status,
    fulfilled: order.fulfilled,
    fulfillmentStatus: order.fulfillmentStatus,
    result: sanitizePublicResult(order.result),
    failReason: publicFailure(order),
    createdAt: order.createdAt,
    fulfilledAt: order.fulfilledAt,
  };
}

export async function createOrder(order) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").insert({
    reference: order.reference,
    order_type: order.orderType,
    network: order.network,
    phone: order.phone,
    email: order.email,
    amount: order.amount,
    provider_cost: order.providerCost ?? order.amount,
    checkout_amount: order.checkoutAmount ?? null,
    paystack_fee_amount: order.paystackFeeAmount ?? null,
    customer_product_amount: order.customerProductAmount ?? null,
    business_markup_amount: order.businessMarkupAmount ?? null,
    idempotency_key: order.idempotencyKey || null,
    bundle_id: order.bundleId || null,
    afa_details: order.afaDetails || null,
    meter_number: order.meterNumber || null,
    tv_details: order.tvDetails || null,
    checker_details: order.checkerDetails || null,
    tier_details: order.tierDetails || null,
    status: order.status || "pending",
    fail_reason: order.failReason || null,
    fulfillment_status: "pending",
  }).select().single();
  if (error) {
    // A unique idempotency constraint turns concurrent retries into a safe
    // read of the original order rather than a second checkout reference.
    if (order.idempotencyKey && error.code === "23505") {
      const { data: existing, error: lookupError } = await supabase
        .from("orders")
        .select("*")
        .eq("idempotency_key", order.idempotencyKey)
        .maybeSingle();
      if (!lookupError && existing) return fromRow(existing);
    }
    throw new Error(error.message);
  }
  return fromRow(data);
}

export async function getOrderByIdempotencyKey(idempotencyKey) {
  if (!idempotencyKey) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").select("*").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

export async function getOrder(reference) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").select("*").eq("reference", reference).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

export async function findCustomerOrder(reference, email) {
  const supabase = getSupabase();
  // NOTE: intentionally .eq(), not .ilike() — ilike() treats `email` as a SQL
  // LIKE pattern, so a value like "%@%" (which passes an `email.includes("@")`
  // check) would match every order's email and bypass ownership verification
  // entirely. Emails are normalized to lowercase at write time and by every
  // caller of this function, so an exact match is both correct and safe.
  const { data, error } = await supabase.from("orders").select("*").eq("reference", reference).eq("email", email).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

// All orders for one email — used by a logged-in customer's account page,
// where the email comes from the verified session, not user-typed input,
// so exact-match .eq() ownership scoping still holds the same way it does
// for findCustomerOrder above.
export async function listOrdersByEmail(email) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").select("*").eq("email", email).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(fromRow);
}

export async function markPaymentVerified(reference, paymentAmount) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({
    status: "payment_verified",
    payment_amount: paymentAmount,
    payment_verified_at: new Date().toISOString(),
    fulfillment_status: "ready",
    fail_reason: null,
  }).eq("reference", reference).eq("fulfilled", false).in("fulfillment_status", ["pending", "failed", "ready"]).select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : getOrder(reference);
}

export async function claimFulfillment(reference) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({
    fulfillment_status: "processing",
    processing_started_at: new Date().toISOString(),
  }).eq("reference", reference).eq("fulfilled", false).eq("status", "payment_verified").in("fulfillment_status", ["ready", "failed"]).select().maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const { data: incremented, error: incrementError } = await supabase.from("orders").update({
    fulfillment_attempts: Number(data.fulfillment_attempts || 0) + 1,
  }).eq("reference", reference).eq("fulfillment_status", "processing").select().single();
  if (incrementError) throw new Error(incrementError.message);
  return fromRow(incremented);
}

export async function markFulfilled(reference, result) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({
    fulfilled: true,
    status: "success",
    fulfillment_status: "fulfilled",
    result,
    last_fulfillment_error: null,
    processing_started_at: null,
    fulfilled_at: new Date().toISOString(),
  }).eq("reference", reference).eq("fulfilled", false).eq("fulfillment_status", "processing").select().single();
  if (error) throw new Error(error.message);
  return fromRow(data);
}

// "Queued with provider" — a deliberately honest intermediate state for
// tiers Techlink itself documents as non-instant (currently MTN Master).
// Their own docs: the initial order-accepted response only confirms the
// order entered their queue, not that it reached the recipient's phone
// ("providers settle asynchronously and a callback can be lost"). Marking
// straight to "fulfilled" here is what caused a customer to get a
// "Delivered!" message for an order that was, in fact, still processing
// at Techlink.
export async function markQueuedWithProvider(reference, result) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({
    fulfillment_status: "queued_with_provider",
    result,
    processing_started_at: new Date().toISOString(),
  }).eq("reference", reference).eq("fulfilled", false).eq("fulfillment_status", "processing").select().single();
  if (error) throw new Error(error.message);
  return fromRow(data);
}

// Called once Techlink's own verify-status endpoint confirms real
// completion — this is the ONLY path that should ever move a queued order
// to "fulfilled" and trigger the real "Delivered" notification.
export async function finalizeQueuedOrder(reference, result) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({
    fulfilled: true,
    status: "success",
    fulfillment_status: "fulfilled",
    result,
    last_fulfillment_error: null,
    processing_started_at: null,
    fulfilled_at: new Date().toISOString(),
  }).eq("reference", reference).eq("fulfilled", false).eq("fulfillment_status", "queued_with_provider").select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

export async function markQueuedOrderFailed(reference, reason) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({
    status: "payment_verified",
    fulfillment_status: "failed",
    last_fulfillment_error: String(reason || "Provider confirmed the order failed").slice(0, 2000),
    fail_reason: "provider_confirmed_failed",
  }).eq("reference", reference).eq("fulfilled", false).eq("fulfillment_status", "queued_with_provider").select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

export async function markFulfillmentFailed(reference, reason) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({
    status: "payment_verified",
    fulfillment_status: "failed",
    processing_started_at: null,
    last_fulfillment_error: String(reason || "Fulfillment failed").slice(0, 2000),
    fail_reason: "fulfillment_failed",
  }).eq("reference", reference).eq("fulfilled", false).eq("fulfillment_status", "processing").select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : getOrder(reference);
}

// The Techlink call for this order ended ambiguously (timeout, dropped
// connection, 5xx): it may already have been delivered and debited. Resubmitting
// automatically risks delivering twice and debiting the wallet twice, so the
// order goes straight to manual_review. An admin confirms the outcome in the
// Techlink dashboard, then either "confirm_fulfilled" or an authorized "retry".
export async function markFulfillmentAmbiguous(reference, reason) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({
    status: "payment_verified",
    fulfillment_status: "manual_review",
    fail_reason: "provider_outcome_unknown",
    last_fulfillment_error: `Techlink outcome unknown (${String(reason || "no response").slice(0, 1500)}). Check Techlink's order list for this recipient BEFORE retrying — it may already have been delivered.`,
    processing_started_at: null,
    manual_review_at: new Date().toISOString(),
    urgent_review_notified_at: null,
  }).eq("reference", reference).eq("fulfilled", false).eq("fulfillment_status", "processing").select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : getOrder(reference);
}

// manual_review orders whose urgent escalation has not gone out yet. The
// notify/escalate loop in recoverAndListReadyOrders used to see an order only
// on the single run that promoted it (when ~0 minutes had elapsed), so the
// 30-minute urgent escalation could never fire. Listing them here lets every
// cron run re-evaluate them; each notification is still guarded by its own
// *_notified_at column, so nothing is sent twice.
export async function listManualReviewAwaitingEscalation(limit = 50) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders")
    .select("*")
    .eq("fulfilled", false)
    .eq("status", "payment_verified")
    .eq("fulfillment_status", "manual_review")
    .is("urgent_review_notified_at", null)
    .order("manual_review_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).map(fromRow);
}

// Holds an order for a human when its outcome is uncertain in a way that makes
// an automatic retry unsafe — e.g. a bulk batch where Techlink reports that
// only SOME rows went through. The order (and Techlink's response) is kept so
// the admin can see exactly what came back. Retrying a bulk order resubmits the
// WHOLE batch, so the note says to verify each recipient first.
export async function markHeldForManualReview(reference, { failReason, error, result }) {
  const supabase = getSupabase();
  const { data, error: dbError } = await supabase.from("orders").update({
    status: "payment_verified",
    fulfillment_status: "manual_review",
    fail_reason: failReason || "held_for_review",
    last_fulfillment_error: String(error || "Held for manual review").slice(0, 2000),
    result: result ?? null,
    processing_started_at: null,
    manual_review_at: new Date().toISOString(),
    urgent_review_notified_at: null,
  }).eq("reference", reference).eq("fulfilled", false).eq("fulfillment_status", "processing").select().maybeSingle();
  if (dbError) throw new Error(dbError.message);
  return data ? fromRow(data) : getOrder(reference);
}

// Queued orders that have waited longer than staleMinutes and haven't had an
// admin alert yet. Each is CLAIMED (queued_alert_sent_at set) in one atomic
// update so two overlapping cron runs can't both alert; the caller releases
// the claim if the alert could not actually be delivered.
export async function claimStaleQueuedAlerts(staleMinutes = 180, limit = 20) {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const { data: rows, error: findError } = await supabase.from("orders")
    .select("reference")
    .eq("fulfilled", false)
    .eq("status", "payment_verified")
    .eq("fulfillment_status", "queued_with_provider")
    .is("queued_alert_sent_at", null)
    .lt("processing_started_at", cutoff)
    .order("processing_started_at", { ascending: true })
    .limit(limit);
  if (findError) throw new Error(findError.message);
  const references = (rows || []).map((r) => r.reference);
  if (!references.length) return [];
  const { data, error } = await supabase.from("orders").update({
    queued_alert_sent_at: new Date().toISOString(),
  }).in("reference", references).eq("fulfilled", false).eq("status", "payment_verified").eq("fulfillment_status", "queued_with_provider").is("queued_alert_sent_at", null).select();
  if (error) throw new Error(error.message);
  return (data || []).map(fromRow);
}

export async function releaseQueuedAlert(reference) {
  const supabase = getSupabase();
  const { error } = await supabase.from("orders").update({ queued_alert_sent_at: null }).eq("reference", reference);
  if (error) throw new Error(error.message);
}

export async function markPaymentPending(reference, reason) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({
    status: "payment_pending",
    fail_reason: reason || null,
    fulfillment_status: "pending",
  }).eq("reference", reference)
    .eq("fulfilled", false)
    .in("status", ["pending", "payment_pending"])
    .select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : getOrder(reference);
}

export async function markPaymentFailed(reference, reason) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({
    status: "payment_failed",
    fail_reason: reason,
    fulfillment_status: "pending",
    processing_started_at: null,
  }).eq("reference", reference)
    .eq("fulfilled", false)
    .in("status", ["pending", "payment_pending"])
    .select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : getOrder(reference);
}

// Backward-compatible alias: payment failures must never mark fulfillment as failed.
export async function markFailed(reference, reason) {
  return markPaymentFailed(reference, reason);
}

export async function listOrders() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []).map(fromRow);
}

export async function recoverStaleProcessingOrders(staleMinutes = 10, limit = 20) {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const { data: staleRows, error: findError } = await supabase.from("orders")
    .select("reference")
    .eq("fulfilled", false)
    .eq("fulfillment_status", "processing")
    .lt("processing_started_at", cutoff)
    .order("processing_started_at", { ascending: true })
    .limit(limit);
  if (findError) throw new Error(findError.message);
  const references = (staleRows || []).map((row) => row.reference);
  if (!references.length) return [];
  const reviewAt = new Date().toISOString();
  const { data, error } = await supabase.from("orders").update({
    fulfillment_status: "manual_review",
    status: "payment_verified",
    fail_reason: "stale_fulfillment_recovered",
    last_fulfillment_error: "Fulfillment worker stopped after a stale claim. Confirm provider outcome before retrying to avoid duplicate delivery.",
    processing_started_at: null,
    manual_review_at: reviewAt,
    urgent_review_notified_at: null,
  }).in("reference", references).eq("fulfilled", false).eq("fulfillment_status", "processing").select();
  if (error) throw new Error(error.message);
  return (data || []).map(fromRow);
}

// Orders that failed OUTRIGHT (a Techlink call threw — insufficient wallet
// balance, bad meter/account, provider error) are automatically retried by
// listReadyOrders up to MAX_FULFILLMENT_ATTEMPTS. Until this function
// existed, once an order exhausted those attempts it just sat at
// fulfillment_status "failed" forever: excluded from further automatic
// retry (attempts >= max), and invisible to the admin email/SMS escalation
// pipeline, which only ever looked at orders recovered from "processing"
// by recoverStaleProcessingOrders above. A run of failures with the same
// root cause (e.g. the Techlink wallet running dry — every order after
// that point fails the same way) would generate zero alerts; admins would
// only find out by opening the dashboard. Promoting exhausted "failed"
// orders into the same "manual_review" state used by the stale-processing
// path routes them through the exact same, already-working notification
// and urgent-escalation logic in recoverAndListReadyOrders, rather than
// building a second, parallel notification path.
export async function promoteExhaustedFailedOrders(limit = 20) {
  const supabase = getSupabase();
  const maxAttempts = Number(process.env.MAX_FULFILLMENT_ATTEMPTS || 5);
  const { data: exhaustedRows, error: findError } = await supabase.from("orders")
    .select("reference")
    .eq("fulfilled", false)
    .eq("status", "payment_verified")
    .eq("fulfillment_status", "failed")
    .gte("fulfillment_attempts", maxAttempts)
    .is("manual_review_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (findError) throw new Error(findError.message);
  const references = (exhaustedRows || []).map((row) => row.reference);
  if (!references.length) return [];
  const reviewAt = new Date().toISOString();
  const { data, error } = await supabase.from("orders").update({
    fulfillment_status: "manual_review",
    manual_review_at: reviewAt,
    urgent_review_notified_at: null,
  }).in("reference", references).eq("fulfilled", false).eq("status", "payment_verified").eq("fulfillment_status", "failed").is("manual_review_at", null).select();
  if (error) throw new Error(error.message);
  return (data || []).map(fromRow);
}

export async function markManualReviewNotified(reference) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").select("*").eq("reference", reference).eq("status", "payment_verified").is("manual_review_notified_at", null).eq("fulfillment_status", "manual_review").maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

export async function recordManualReviewNotified(reference) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({ manual_review_notified_at: new Date().toISOString() }).eq("reference", reference).eq("status", "payment_verified").is("manual_review_notified_at", null).eq("fulfillment_status", "manual_review").select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

export async function markCustomerDelayNotified(reference) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").select("*").eq("reference", reference).eq("status", "payment_verified").is("customer_delay_notified_at", null).eq("fulfillment_status", "manual_review").maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

export async function recordCustomerDelayNotified(reference) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({ customer_delay_notified_at: new Date().toISOString() }).eq("reference", reference).eq("status", "payment_verified").is("customer_delay_notified_at", null).eq("fulfillment_status", "manual_review").select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

// "queued_with_provider" is accepted as a source state ONLY for
// confirm_fulfilled below (not retry — see that branch for why), so a BULK
// non-instant tier order isn't a permanent dead end: Techlink's bulk
// response may carry no orderId (unconfirmed), in which case those cannot auto-resolve via
// checkQueuedOrder, and an admin who has confirmed delivery with Techlink
// directly needs a way to close it out.
export async function manuallyResolveOrder(reference, action, note) {
  const supabase = getSupabase();
  const cleanNote = String(note || '').trim().slice(0, 2000);
  if (cleanNote.length < 5) throw new Error('A resolution note of at least 5 characters is required');

  if (action === 'confirm_fulfilled') {
    const { data, error } = await supabase.from("orders").update({
      fulfilled: true,
      status: "success",
      fulfillment_status: "fulfilled",
      result: { manualConfirmation: true, note: cleanNote, confirmedAt: new Date().toISOString() },
      last_fulfillment_error: null,
      processing_started_at: null,
      fulfilled_at: new Date().toISOString(),
      manual_review_resolution: cleanNote,
      manual_review_resolved_at: new Date().toISOString(),
    }).eq("reference", reference).eq("fulfilled", false).eq("status", "payment_verified").in("fulfillment_status", ["manual_review", "failed", "queued_with_provider"]).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data ? fromRow(data) : null;
  }

  if (action === 'retry') {
    const { data, error } = await supabase.from("orders").update({
      status: "payment_verified",
      fulfillment_status: "ready",
      fail_reason: null,
      last_fulfillment_error: `Admin-authorized retry: ${cleanNote}`,
      processing_started_at: null,
      manual_review_resolution: `Retry authorized: ${cleanNote}`,
      manual_review_resolved_at: new Date().toISOString(),
      manual_review_notified_at: null,
      customer_delay_notified_at: null,
      // Accepts orders already promoted to manual_review, and also an order
      // still sitting at "failed" that hasn't been promoted yet (admin
      // doesn't have to wait for it to exhaust its automatic retries before
      // acting on it directly) — e.g. an instant order like airtime that
      // couldn't be delivered because the Techlink wallet balance was
      // insufficient.
      // Deliberately does NOT accept "queued_with_provider" the way
      // confirm_fulfilled above does: that state means the bulk order was
      // already submitted and accepted by Techlink, just unconfirmed —
      // "retry" resubmits the whole batch, which would risk delivering it
      // twice. An admin-confirmed queued order can only be closed out as
      // fulfilled, never retried.
    }).eq("reference", reference).eq("fulfilled", false).eq("status", "payment_verified").in("fulfillment_status", ["manual_review", "failed"]).select().maybeSingle();
    if (error) throw new Error(error.message);
    return data ? fromRow(data) : null;
  }

  throw new Error('Unsupported manual review action');
}

export async function recordUrgentReviewNotified(reference) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({ urgent_review_notified_at: new Date().toISOString() }).eq("reference", reference).eq("status", "payment_verified").eq("fulfillment_status", "manual_review").is("urgent_review_notified_at", null).select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

export async function listManualReviewOrders(limit = 50) {
  const supabase = getSupabase();
  // "failed" is included directly alongside "manual_review" so an order is
  // visible here from the moment it first fails, not just after it's been
  // promoted (promoteExhaustedFailedOrders promotes it — and triggers admin
  // notification — only once its automatic retries are exhausted).
  const { data, error } = await supabase.from("orders").select("*").eq("fulfilled", false).eq("status", "payment_verified").in("fulfillment_status", ["manual_review", "failed"]).order("created_at", { ascending: true }).limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).map(fromRow);
}

export async function listQueuedOrders(limit = 20) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders")
    .select("*")
    .eq("fulfilled", false)
    .eq("status", "payment_verified")
    .eq("fulfillment_status", "queued_with_provider")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).map(fromRow);
}

export async function listReadyOrders(limit = 20) {
  const supabase = getSupabase();
  const maxAttempts = Number(process.env.MAX_FULFILLMENT_ATTEMPTS || 5);
  const { data, error } = await supabase.from("orders").select("*").eq("fulfilled", false).eq("status", "payment_verified").in("fulfillment_status", ["ready", "failed"]).lt("fulfillment_attempts", maxAttempts).order("created_at", { ascending: true }).limit(limit);
  if (error) throw new Error(error.message);
  return (data || []).map(fromRow);
}
