-- v1.3.7: record what Paystack ACTUALLY charged per order.
-- paystack_fee_amount (existing) is our computed estimate; these two are the
-- real figures from the Paystack verify response (`fees`, converted to GHS).
-- Safe to run more than once. Run this BEFORE deploying the matching code;
-- the code also keeps working if the columns are missing (it retries without them).
alter table orders add column if not exists paystack_fee_actual numeric;
alter table orders add column if not exists paystack_net_settled numeric;
