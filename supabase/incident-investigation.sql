-- ============================================================================
-- READ-ONLY. "Two orders reached Techlink and nobody paid for them": how?
-- Replace the phone number / time window with your own, then run each block.
-- ============================================================================

-- A. The orders, with the payment evidence our own database holds.
--    A genuine paid order has status = 'payment_verified' or 'success', a
--    payment_verified_at time, and payment_amount (in PESEWAS) equal to
--    checkout_amount x 100.
select reference, order_no, order_type, network, phone, amount, checkout_amount,
       status, fulfillment_status, payment_verified_at, payment_amount,
       paystack_transaction_id, fulfilled, fulfilled_at,
       last_fulfillment_error, manual_review_resolution, created_at
from orders
where phone = '0551864239'
  and created_at >= '2026-10-01 00:00:00+00' and created_at < '2026-10-02 00:00:00+00'
order by created_at;

-- B. WHO or WHAT moved them. The audit log records admin actions and worker
--    decisions. Look for admin_mark_paid_send, admin_approve_delivery,
--    admin_process_now, admin_ran_worker, manual_review_retry, accept_charged.
--    If NONE of those appear for these references, no admin action sent them:
--    the worker did, on a Paystack "success".
select created_at, actor, action, reference, note
from audit_log
where created_at >= '2026-10-01 00:00:00+00' and created_at < '2026-10-02 00:00:00+00'
  and (reference in (select reference from orders where phone = '0551864239')
       or action like 'admin_%' or action like 'payment_%')
order by created_at;

-- C. Did Paystack tell us about a payment (webhook), or did the worker's
--    "stale checkout sweep" find it? Webhook rows show up here.
select created_at, event_key, reference, status, attempts, last_error
from paystack_webhook_events
where reference in (select reference from orders where phone = '0551864239')
order by created_at;

-- D. Anything delivered in the last 7 days WITHOUT a recorded payment.
--    EXPECTED: ZERO rows. Any row here is an order Techlink delivered that our
--    own records say was never paid for.
select reference, order_type, phone, amount, status, fulfillment_status,
       payment_verified_at, payment_amount, fulfilled_at
from orders
where fulfilled = true
  and fulfilled_at >= now() - interval '7 days'
  and (payment_verified_at is null or payment_amount is null)
order by fulfilled_at desc;

-- E. Also check in the PAYSTACK dashboard (top-left Test/Live switch): were
--    these references paid in LIVE mode, TEST mode, or not at all?
