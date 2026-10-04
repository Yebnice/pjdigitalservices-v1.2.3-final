-- PjDigitalServices v1.4.6 payment-state semantics.
-- Terminal payment failures/abandoned checkouts must never carry a misleading
-- fulfillment_status of "pending". "pending" is reserved for an unresolved
-- payment checkout. These rows are not awaiting fulfillment.

-- Existing terminal payment failures.
update public.orders
set fulfillment_status = 'not_applicable'
where fulfilled = false
  and status = 'payment_failed';

-- Historical failed rows that were already normalized to payment_failed are
-- covered by the statement above; this explicit form documents the intended
-- abandoned state for clarity.
update public.orders
set fulfillment_status = 'not_applicable'
where fulfilled = false
  and status = 'payment_failed'
  and fail_reason = 'payment_abandoned';

-- Keep the delivery guard authoritative: only payment_verified rows with a
-- payment timestamp may enter a provider/delivery state. "not_applicable" is
-- intentionally outside the delivery states.

notify pgrst, 'reload schema';
