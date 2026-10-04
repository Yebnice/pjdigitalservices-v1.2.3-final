import { getSupabase } from "./supabaseClient";
import { generateOrderNo, looksLikeOrderNo } from "./orderNo";
import { extractVouchers } from "./vouchers";
import { decryptAfaDetails, encryptAfaDetails } from "./afaSecurity";
import { fetchAllRows } from "./adminOrders";

export function fromRow(row) {
  return {
    reference: row.reference,
    orderNo: row.order_no || null,
    paystackTransactionId: row.paystack_transaction_id || null,
    orderType: row.order_type,
    network: row.network,
    phone: row.phone,
    email: row.email,
    amount: Number(row.amount),
    providerCost: row.provider_cost == null ? Number(row.amount) : Number(row.provider_cost),
    checkoutAmount: row.checkout_amount == null ? null : Number(row.checkout_amount),
    paystackFeeAmount: row.paystack_fee_amount == null ? null : Number(row.paystack_fee_amount),
    paystackFeeActual: row.paystack_fee_actual == null ? null : Number(row.paystack_fee_actual),
    paystackNetSettled: row.paystack_net_settled == null ? null : Number(row.paystack_net_settled),
    customerProductAmount: row.customer_product_amount == null ? null : Number(row.customer_product_amount),
    businessMarkupAmount: row.business_markup_amount == null ? null : Number(row.business_markup_amount),
    idempotencyKey: row.idempotency_key || null,
    bundleId: row.bundle_id,
    afaDetails: decryptAfaDetails(row.afa_details),
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
    paymentChargedAt: row.payment_charged_at,
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
  // Result-checker vouchers (serial + PIN): rebuilt field by field, never passed through
  // raw. This shape is only ever served to the VERIFIED OWNER of the order (see
  // toPublicOrderForViewer) and is kept out of the AI assistant's prompt.
  const vouchers = extractVouchers(result);
  if (vouchers.length) out.checkers = vouchers;
  return out;
}

function publicFailure(order) {
  if (order.fulfillmentStatus === "failed") return "We could not complete this order. Please contact support with your order number.";
  return null;
}

// 0551864239 -> 055•••4239. Enough for a customer to recognise their own order
// in a table, not enough to publish a number.
export function maskPhone(phone) {
  const p = String(phone || "").replace(/\s+/g, "");
  if (p.length < 7) return p ? "•••" : null;
  return `${p.slice(0, 3)}•••${p.slice(-4)}`;
}

export function toPublicOrder(order) {
  if (!order) return null;
  return {
    // orderNo is OUR number (PJ-XXXXXXXX). reference is what Paystack knows the
    // payment as, and paystackTransactionId is Paystack's own numeric id.
    orderNo: order.orderNo || order.reference,
    paystackReference: order.reference,
    paystackTransactionId: order.paystackTransactionId || null,
    phoneMasked: maskPhone(order.phone),
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
    paymentVerifiedAt: order.paymentVerifiedAt,
    fulfilledAt: order.fulfilledAt,
  };
}

// Same as toPublicOrder, but the delivery result (e.g. an ECG token) is only
// included when the caller proves ownership by supplying the order's email.
// Order references appear in receipts and browser storage, so a reference on
// its own must not be enough to read a token.
export function toPublicOrderForViewer(order, viewerEmail) {
  const pub = toPublicOrder(order);
  if (!pub) return pub;
  const isOwner =
    viewerEmail && order.email &&
    String(viewerEmail).trim().toLowerCase() === String(order.email).trim().toLowerCase();
  return isOwner ? pub : { ...pub, result: null };
}

export async function createOrder(order) {
  const supabase = getSupabase();
  const row = {
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
    afa_details: order.afaDetails ? encryptAfaDetails(order.afaDetails) : null,
    meter_number: order.meterNumber || null,
    tv_details: order.tvDetails || null,
    checker_details: order.checkerDetails || null,
    tier_details: order.tierDetails || null,
    status: order.status || "pending",
    fail_reason: order.failReason || null,
    fulfillment_status: "pending",
  };

  // Our own order number goes in a column added by migration_v1_4_0.sql. If that
  // migration has not been run yet, fall back to creating the order without it:
  // checkout must never break because of a display number.
  let withNo = true;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const orderNo = order.orderNo || generateOrderNo();
    const { data, error } = await supabase.from("orders").insert(withNo ? { ...row, order_no: orderNo } : row).select().single();
    if (!error) return fromRow(data);

    const message = String(error.message || "");
    if (withNo && (error.code === "PGRST204" || error.code === "42703" || /order_no/.test(message) && /column|schema cache/i.test(message))) {
      console.warn("orders.order_no is missing (run supabase/migration_v1_4_0.sql). Creating the order without it.");
      withNo = false;
      attempt -= 1;
      continue;
    }
    if (error.code === "23505" && /order_no/.test(message) && !order.orderNo) continue; // astronomically rare collision: draw another number

    // A unique idempotency constraint turns concurrent retries into a safe
    // read of the original order rather than a second checkout reference.
    if (order.idempotencyKey && error.code === "23505") {
      const query = supabase
        .from("orders")
        .select("*")
        .eq("idempotency_key", order.idempotencyKey);
      if (order.email) query.eq("email", String(order.email).trim().toLowerCase());
      const { data: existing, error: lookupError } = await query.maybeSingle();
      if (!lookupError && existing) return fromRow(existing);
    }
    throw new Error(error.message);
  }
  throw new Error("Could not allocate an order number");
}

export async function getOrderByIdempotencyKey(idempotencyKey, email) {
  if (!idempotencyKey) return null;
  const supabase = getSupabase();
  let query = supabase.from("orders").select("*").eq("idempotency_key", idempotencyKey);
  if (email) query = query.eq("email", String(email).trim().toLowerCase());
  const { data, error } = await query.maybeSingle();
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
  if (data) return fromRow(data);

  // Customers see OUR order number (PJ-XXXXXXXX) on receipts, so accept it too.
  // A separate, exact-match query: no OR-string is ever built from user input.
  const asNo = String(reference || "").trim().toUpperCase();
  if (looksLikeOrderNo(asNo)) {
    const { data: byNo, error: noError } = await supabase.from("orders").select("*").eq("order_no", asNo).eq("email", email).maybeSingle();
    if (!noError && byNo) return fromRow(byNo);
  }
  return null;
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

// `info` carries optional bookkeeping from the Paystack verify response:
//   { feeGhs, netGhs, transactionId }. Recording it must never block delivery:
// if the columns from migration_v1_4_0.sql / migration_v1_3_7.sql are missing,
// retry without them.
function requirePaystackTransactionId(info) {
  const id = info?.transactionId;
  if (id === undefined || id === null || String(id).trim() === "") {
    throw new Error("Paystack transaction ID is missing; automatic payment verification is blocked");
  }
  return String(id).trim();
}

function bookkeepingColumns(info) {
  if (!info) return null;
  const cols = {};
  if (Number.isFinite(info.feeGhs)) { cols.paystack_fee_actual = info.feeGhs; cols.paystack_net_settled = info.netGhs; }
  if (info.transactionId != null && info.transactionId !== "") cols.paystack_transaction_id = String(info.transactionId);
  if (info.paidAt) cols.payment_charged_at = String(info.paidAt);
  return Object.keys(cols).length ? cols : null;
}

export async function markPaymentVerified(reference, paymentAmount, info = null) {
  const supabase = getSupabase();
  const transactionId = requirePaystackTransactionId(info);
  const base = {
    status: "payment_verified",
    payment_amount: paymentAmount,
    payment_verified_at: new Date().toISOString(),
    fulfillment_status: "ready",
    fail_reason: null,
    paystack_transaction_id: transactionId,
  };
  const run = (update) => supabase.from("orders").update(update)
    .eq("reference", reference).eq("fulfilled", false)
    // Only an order that is still unpaid, or already verified, can become "payment verified".
    // (Delivered, resolved and similar orders can never be pulled back into the delivery path.)
    .in("status", ["pending", "payment_pending", "payment_failed", "payment_rejected_after_charge", "payment_verified"])
    .in("fulfillment_status", ["pending", "not_applicable", "failed", "ready"]).select().maybeSingle();

  const extra = bookkeepingColumns(info);
  const update = extra ? { ...base, ...extra } : base;
  const { data, error } = await run(update);
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : getOrder(reference);
}

// A payment Paystack confirms, found where the app must NOT spend wallet money
// on its own (an outstanding-orders check, an old checkout, manual delivery
// mode). The payment is recorded, the order goes to "Needs attention", and
// NOTHING is sent to Techlink until an admin approves it.
export async function holdPaidOrderForReview(reference, { paymentAmount, info = null, note, failReason = "held_for_approval" } = {}) {
  const supabase = getSupabase();
  const transactionId = requirePaystackTransactionId(info);
  const now = new Date().toISOString();
  const base = {
    status: "payment_verified",
    payment_amount: paymentAmount,
    payment_verified_at: now,
    fulfillment_status: "manual_review",
    fail_reason: failReason,
    last_fulfillment_error: String(note || "Paid. Held for admin approval.").slice(0, 2000),
    manual_review_at: now,
    manual_review_notified_at: null,
    urgent_review_notified_at: null,
    paystack_transaction_id: transactionId,
  };
  const run = (update) => supabase.from("orders").update(update)
    .eq("reference", reference).eq("fulfilled", false)
    // payment_failed is included on purpose: a checkout closed as "abandoned" can
    // still turn out to be paid (the customer approved a mobile-money prompt after
    // closing the window). That money must surface, not vanish.
    .in("status", ["pending", "payment_pending", "payment_failed", "payment_rejected_after_charge", "payment_verified"])
    .in("fulfillment_status", ["pending", "ready", "failed", "manual_review"]).select().maybeSingle();
  const extra = bookkeepingColumns(info);
  const update = extra ? { ...base, ...extra } : base;
  const { data, error } = await run(update);
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
  const current = await getOrder(reference);
  const update = {
    fulfilled: true,
    status: "success",
    fulfillment_status: "fulfilled",
    result,
    last_fulfillment_error: null,
    processing_started_at: null,
    fulfilled_at: new Date().toISOString(),
  };
  if (current?.orderType === "afa") update.afa_details = null;
  const { data, error } = await supabase.from("orders").update(update)
    .eq("reference", reference).eq("fulfilled", false).eq("status", "payment_verified").eq("fulfillment_status", "processing").select().single();
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
  }).eq("reference", reference).eq("fulfilled", false).eq("status", "payment_verified").eq("fulfillment_status", "processing").select().single();
  if (error) throw new Error(error.message);
  return fromRow(data);
}

// Called once Techlink's own verify-status endpoint confirms real
// completion — this is the ONLY path that should ever move a queued order
// to "fulfilled" and trigger the real "Delivered" notification.
export async function finalizeQueuedOrder(reference, result) {
  const supabase = getSupabase();
  const current = await getOrder(reference);
  const update = {
    fulfilled: true,
    status: "success",
    fulfillment_status: "fulfilled",
    result,
    last_fulfillment_error: null,
    processing_started_at: null,
    fulfilled_at: new Date().toISOString(),
  };
  if (current?.orderType === "afa") update.afa_details = null;
  const { data, error } = await supabase.from("orders").update(update)
    .eq("reference", reference).eq("fulfilled", false).eq("status", "payment_verified").eq("fulfillment_status", "queued_with_provider").select().maybeSingle();
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
  }).eq("reference", reference).eq("fulfilled", false).eq("status", "payment_verified").eq("fulfillment_status", "queued_with_provider").select().maybeSingle();
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
  }).eq("reference", reference).eq("fulfilled", false).eq("status", "payment_verified").eq("fulfillment_status", "processing").select().maybeSingle();
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
  }).eq("reference", reference).eq("fulfilled", false).eq("status", "payment_verified").eq("fulfillment_status", "processing").select().maybeSingle();
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
  }).eq("reference", reference).eq("fulfilled", false).eq("status", "payment_verified").eq("fulfillment_status", "processing").select().maybeSingle();
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

export async function markPaymentRejectedAfterCharge(reference, reason, paymentAmount, info = null) {
  const supabase = getSupabase();
  const transactionId = requirePaystackTransactionId(info);
  const base = {
    status: "payment_rejected_after_charge",
    fail_reason: reason,
    fulfillment_status: "not_applicable",
    processing_started_at: null,
    payment_amount: paymentAmount,
    paystack_transaction_id: transactionId,
    payment_charged_at: info?.paidAt ? String(info.paidAt) : null,
  };
  const extra = bookkeepingColumns(info);
  const update = extra ? { ...base, ...extra } : base;
  const { data, error } = await supabase.from("orders").update(update)
    .eq("reference", reference)
    .eq("fulfilled", false)
    .in("status", ["pending", "payment_pending", "payment_failed", "payment_rejected_after_charge"])
    .select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : getOrder(reference);
}

export async function markPaymentPending(reference, reason) {
  const supabase = getSupabase();
  // BUG FIX: "payment_verified" used to be an accepted source status here.
  // Once an order has been verified successful, it must never be moved back
  // to "payment_pending" — a later re-verification call (e.g. a duplicate/
  // retried webhook firing before fulfillment has claimed the order) should
  // be a no-op against an already-verified order, not a downgrade. Only
  // orders that were never confirmed successful can legitimately sit in
  // "pending"/"payment_pending".
  const { data, error } = await supabase.from("orders").update({
    status: "payment_pending",
    fail_reason: reason || null,
    fulfillment_status: "pending",
  }).eq("reference", reference)
    .eq("fulfilled", false)
    .in("status", ["pending", "payment_pending"])
    .eq("fulfillment_status", "pending")
    .select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : getOrder(reference);
}

// `paidPesewas` is only passed when Paystack DID charge the customer but we
// rejected the payment (amount/currency mismatch), so the dashboard can show
// exactly what was taken.
export async function markPaymentFailed(reference, reason, paidPesewas = null) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("orders").update({
    status: "payment_failed",
    fail_reason: reason,
    fulfillment_status: "not_applicable",
    processing_started_at: null,
    ...(paidPesewas != null ? { payment_amount: paidPesewas } : {}),
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

// Unpaid-looking checkouts old enough that the customer has either finished
// paying or walked away. Newest first: a paying customer is far more likely to
// be recent, and an ancient abandoned row must not starve them of a turn.
export async function listStalePendingOrders({ olderThanMinutes = 10, newerThanDays = 7, limit = 10 } = {}) {
  const supabase = getSupabase();
  const before = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const after = new Date(Date.now() - newerThanDays * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("orders")
    .select("reference, created_at, status")
    .eq("fulfilled", false)
    .in("status", ["pending", "payment_pending"])
    .lt("created_at", before)
    .gte("created_at", after)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, limit));
  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({ reference: row.reference, createdAt: row.created_at, status: row.status }));
}

// Customers Paystack charged but whose payment we rejected (wrong amount or
// currency). These were invisible everywhere: money taken, nothing sent, and no
// screen listed them. Closed items (refund handled) are excluded.
export async function listChargedButRejectedOrders(limit = 50) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("fulfilled", false)
    .in("status", ["payment_rejected_after_charge", "payment_failed"])
    .in("fail_reason", ["amount_mismatch", "currency_mismatch"])
    .is("manual_review_resolved_at", null)
    .order("created_at", { ascending: true })
    .limit(Math.max(1, limit));
  if (error) throw new Error(error.message);
  return (data || []).map(fromRow);
}

// Stable order: created_at alone is not unique, and rows sharing a timestamp
// can otherwise repeat or vanish between pages.
export function orderedOrders(query) {
  return query.order("created_at", { ascending: false }).order("reference", { ascending: false });
}

export async function listOrders() {
  const supabase = getSupabase();
  const rows = await fetchAllRows((from, to) => orderedOrders(supabase.from("orders").select("*")).range(from, to));
  return rows.map(fromRow);
}

export async function recoverStaleProcessingOrders(staleMinutes = 10, limit = 20) {
  const supabase = getSupabase();
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const { data: staleRows, error: findError } = await supabase.from("orders")
    .select("reference")
    .eq("fulfilled", false)
    .eq("status", "payment_verified")
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
  }).in("reference", references).eq("fulfilled", false).eq("status", "payment_verified").eq("fulfillment_status", "processing").select();
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
// Administrator's manual override, for when the API checks cannot settle an
// order (Paystack and Techlink disagree, a provider dashboard shows something
// the API does not, a customer was dealt with outside the app). It works on ANY
// order that is not yet delivered, in any state, and records who/why via the
// note (the route also writes the audit log).
//
//   mark_delivered  the customer has it (or the admin delivered it himself)
//   mark_resolved   close it WITHOUT delivery (refunded, abandoned, handled elsewhere)
//   mark_paid       the admin confirmed payment himself; move it to "ready to send"
const PROCESSING_GRACE_MS = 5 * 60_000;

export async function manualOverride(reference, action, note) {
  const supabase = getSupabase();
  const cleanNote = String(note || "").trim().slice(0, 2000);
  if (cleanNote.length < 5) throw new Error("A note of at least 5 characters is required");
  const current = await getOrder(reference);
  if (!current) return null;
  if (current.fulfilled) throw new Error("This order is already delivered, so there is nothing to override.");
  // A delivery is being made to Techlink right now. Overriding mid-flight
  // could record it twice or lose the provider's answer.
  const startedAt = current.processingStartedAt ? new Date(current.processingStartedAt).getTime() : 0;
  if (current.fulfillmentStatus === "processing" && Date.now() - startedAt < PROCESSING_GRACE_MS) {
    throw new Error("This order is being sent to Techlink right now. Wait a minute and try again.");
  }
  const now = new Date().toISOString();
  const common = { manual_review_resolved_at: now, processing_started_at: null, queued_alert_sent_at: null };

  let patch;
  if (action === "mark_delivered") {
    // A manual "Mark delivered" action may only close an order after the
    // application has a complete live-Paystack verification record. It must
    // never manufacture payment_verified_at or turn an unpaid checkout into
    // a paid sale simply because an admin clicked the wrong button.
    if (!["payment_verified", "payment_rejected_after_charge", "success"].includes(current.status)) {
      throw new Error("Cannot mark delivered: payment has not been verified in Paystack.");
    }
    if (
      !current.paymentVerifiedAt ||
      current.paymentAmount == null ||
      !current.paystackTransactionId
    ) {
      throw new Error("Cannot mark delivered: complete Paystack payment evidence is missing.");
    }

    const providerResult = current.result && typeof current.result === "object" && !Array.isArray(current.result) ? current.result : {};
    patch = {
      ...common,
      fulfilled: true,
      status: "success",
      fulfillment_status: "fulfilled",
      fulfilled_at: now,
      fail_reason: null,
      last_fulfillment_error: null,
      payment_verified_at: current.paymentVerifiedAt,
      result: { ...providerResult, manualConfirmation: true, manualConfirmationNote: cleanNote, confirmedAt: now },
      manual_review_resolution: `Marked delivered by admin: ${cleanNote}`,
    };
  } else if (action === "mark_resolved") {
    if (["pending", "payment_pending"].includes(current.status)) {
      // Never paid: file it with the other closed checkouts (hidden from the
      // customer's order list, shown as "Payment cancelled").
      patch = { ...common, status: "payment_failed", fail_reason: "payment_abandoned", fulfillment_status: "not_applicable", manual_review_resolution: `Closed by admin (no payment): ${cleanNote}` };
    } else if (["payment_verified", "payment_rejected_after_charge"].includes(current.status)) {
      // Paid, but closed without delivery (refunded, or settled some other way).
      patch = { ...common, fulfillment_status: "resolved", manual_review_resolution: `Resolved by admin: ${cleanNote}` };
    } else {
      patch = { ...common, manual_review_resolution: `Resolved by admin: ${cleanNote}` };
    }
  } else if (action === "mark_paid") {
    if (!["pending", "payment_pending", "payment_failed", "payment_rejected_after_charge"].includes(current.status)) throw new Error("This order is not waiting on a payment confirmation.");
    patch = {
      ...common,
      status: "payment_verified",
      fulfillment_status: "ready",
      fail_reason: null,
      fulfillment_attempts: 0,
      payment_verified_at: now,
      last_fulfillment_error: `Payment confirmed manually by admin: ${cleanNote}`,
      manual_review_resolution: `Payment confirmed manually: ${cleanNote}`,
      manual_review_notified_at: null,
      customer_delay_notified_at: null,
    };
  } else {
    throw new Error("Unsupported manual override action");
  }
  const { data, error } = await supabase.from("orders").update(patch).eq("reference", reference).eq("fulfilled", false).select().maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data) : null;
}

export async function manuallyResolveOrder(reference, action, note) {
  const supabase = getSupabase();
  const cleanNote = String(note || '').trim().slice(0, 2000);
  if (cleanNote.length < 5) throw new Error('A resolution note of at least 5 characters is required');

  if (action === 'confirm_fulfilled') {
    const current = await getOrder(reference);
    if (!current || current.fulfilled || current.status !== "payment_verified" ||
        !["manual_review", "failed", "queued_with_provider"].includes(current.fulfillmentStatus)) {
      return null;
    }
    // Preserve the original Techlink response. The manual confirmation is
    // operational metadata, not a replacement for the provider evidence.
    const providerResult = current.result && typeof current.result === "object" && !Array.isArray(current.result)
      ? current.result
      : {};
    const { data, error } = await supabase.from("orders").update({
      fulfilled: true,
      status: "success",
      fulfillment_status: "fulfilled",
      result: {
        ...providerResult,
        manualConfirmation: true,
        manualConfirmationNote: cleanNote,
        confirmedAt: new Date().toISOString(),
      },
      last_fulfillment_error: null,
      processing_started_at: null,
      fulfilled_at: new Date().toISOString(),
      manual_review_resolution: cleanNote,
      manual_review_resolved_at: new Date().toISOString(),
      queued_alert_sent_at: null,
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

  if (action === "close_charged") {
    // The customer was charged and we rejected the payment; the admin has dealt
    // with it outside the app (refund, top-up, contacting the customer).
    const { data, error } = await supabase.from("orders").update({
      manual_review_resolution: `Closed: ${cleanNote}`,
      manual_review_resolved_at: new Date().toISOString(),
    }).eq("reference", reference).eq("fulfilled", false).in("status", ["payment_rejected_after_charge", "payment_failed"]).in("fail_reason", ["amount_mismatch", "currency_mismatch"]).select().maybeSingle();
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
  const attentionLimit = Math.max(1, limit);
  const pendingCutoff = new Date(Date.now() - 5 * 60_000).toISOString();

  // These states need an operator-visible escape hatch:
  // - ready: payment is verified but the provider call has not started.
  // - failed: a provider attempt failed definitively and can be retried after
  //   the admin confirms the failure is safe to retry.
  // - manual_review: provider outcome is uncertain or otherwise held.
  // - queued_with_provider: provider accepted the order, so retry is unsafe;
  //   re-check or confirm delivery instead.
  const { data: attentionRows, error: attentionError } = await supabase
    .from("orders")
    .select("*")
    .eq("fulfilled", false)
    .eq("status", "payment_verified")
    .in("fulfillment_status", ["ready", "manual_review", "failed", "queued_with_provider"])
    .order("created_at", { ascending: true })
    .limit(attentionLimit);

  if (attentionError) throw new Error(attentionError.message);

  // Also surface older unresolved payment records. Re-verification is safe
  // here because no fulfillment call is made unless Paystack now confirms the
  // exact checkout amount as successful.
  const remaining = Math.max(0, attentionLimit - (attentionRows || []).length);
  let pendingRows = [];
  if (remaining > 0) {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("fulfilled", false)
      .in("status", ["pending", "payment_pending"])
      .lt("created_at", pendingCutoff)
      .order("created_at", { ascending: true })
      .limit(remaining);
    if (error) throw new Error(error.message);
    pendingRows = data || [];
  }

  const seen = new Set();
  return [...(attentionRows || []), ...pendingRows]
    .filter((row) => {
      if (seen.has(row.reference)) return false;
      seen.add(row.reference);
      return true;
    })
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(0, attentionLimit)
    .map(fromRow);
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
