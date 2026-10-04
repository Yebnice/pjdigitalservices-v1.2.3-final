-- PjDigitalServices v1.4.7 payment bookkeeping.
-- A Paystack SUCCESS that cannot be accepted for the order (wrong amount/currency)
-- is a real charge, not a failed payment. Keep it separate and auditable.

alter table public.orders
  add column if not exists payment_charged_at timestamptz;

-- Convert only the legacy charged-mismatch rows we can identify with certainty.
-- Do not invent a charge timestamp: older rows may not contain the actual Paystack paid_at.
update public.orders
set
  status = 'payment_rejected_after_charge',
  fulfillment_status = 'not_applicable'
where fulfilled = false
  and status = 'payment_failed'
  and fail_reason in ('amount_mismatch', 'currency_mismatch');

notify pgrst, 'reload schema';
