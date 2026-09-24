-- PjDigitalServices v1.2.5 — Paystack fee pass-through migration
--
-- `amount` keeps meaning what it always meant: the authoritative product
-- cost (what's actually sent to Techlink for fulfillment, and what the
-- business needs to net per order). It is UNCHANGED by this migration.
--
-- `checkout_amount` is the new column: amount + the 1.95% Paystack fee,
-- marked up so that after Paystack deducts its cut, the business still
-- nets exactly `amount`. This is what the customer is actually charged
-- and what Paystack will report back as the transaction amount.
--
-- `paystack_fee_amount` is checkout_amount - amount, stored for transparent
-- reporting (receipts, admin dashboard, reconciliation) without having to
-- recompute it everywhere.
--
-- Both are nullable: existing pending orders created before this deploy
-- won't have them, and lib/orderProcessing.js falls back to `amount` for
-- verification when checkout_amount is null so in-flight orders at deploy
-- time still verify correctly against what was actually charged.

alter table orders add column if not exists checkout_amount numeric;
alter table orders add column if not exists paystack_fee_amount numeric;
