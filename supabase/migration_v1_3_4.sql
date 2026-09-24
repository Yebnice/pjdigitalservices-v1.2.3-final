-- PjDigitalServices v1.3.4 migration
-- Separate payment failures from fulfillment failures.
-- Safe to run repeatedly.

-- Historical orders created by the old payment verifier could have both
-- status='failed' and fulfillment_status='failed' even though no Techlink
-- fulfillment was ever attempted. Normalize those records so they can never
-- be picked up as fulfillment retries.
update orders
set
  status = 'payment_failed',
  fulfillment_status = 'pending'
where fulfilled = false
  and status = 'failed'
  and fulfillment_status = 'failed'
  and payment_verified_at is null;

create index if not exists orders_payment_state_idx
  on orders (status, fulfillment_status, created_at);
