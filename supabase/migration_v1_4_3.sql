-- v1.4.3: normalise old "abandoned" checkouts. One plain, repeatable UPDATE; no schema change.
-- Older versions recorded Paystack's own word "abandoned" as the failure reason, while the customer
-- site and the admin "Abandoned checkouts" filter look for "payment_abandoned". Those checkouts
-- therefore showed up as "Payment failed". The code now records payment_abandoned; this fixes
-- the rows that were already saved. Safe to run more than once. Run it after migration_v1_4_0.sql.
update orders
set fail_reason = 'payment_abandoned'
where fail_reason = 'abandoned'
  and status = 'payment_failed'
  and fulfilled = false;

-- Check: EXPECTED 0 rows left
select count(*) as legacy_abandoned_left from orders where fail_reason = 'abandoned';
