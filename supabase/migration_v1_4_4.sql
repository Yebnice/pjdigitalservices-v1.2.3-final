-- v1.4.4: database-level lock on delivery.
-- Even if some future code path, script or manual SQL edit tried to start a delivery for an
-- order with no recorded payment, the database itself refuses. This is the third lock behind
--   (1) the app's claimFulfillment() filter and (2) evaluateDelivery().
-- It checks only what every legitimate path sets (status + payment_verified_at), so an admin's
-- "mark paid and send" and "Approve & deliver" keep working exactly as before.
--
-- NOT TESTED against a live Postgres by the author of this change. Run it first on a Supabase
-- branch / staging project, place one test order, then run it on production.
-- Roll back with:  drop trigger if exists orders_require_payment_before_delivery on orders;

create or replace function orders_require_payment_before_delivery() returns trigger as $$
begin
  if new.fulfillment_status in ('processing', 'queued_with_provider')
     and (tg_op = 'INSERT' or old.fulfillment_status is distinct from new.fulfillment_status) then
    if new.status is distinct from 'payment_verified' or new.payment_verified_at is null then
      raise exception 'Order % cannot be sent to the provider: no verified payment is recorded for it.', new.reference
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists orders_require_payment_before_delivery on orders;
create trigger orders_require_payment_before_delivery
  before insert or update on orders
  for each row execute function orders_require_payment_before_delivery();

-- Read-only check you can run afterwards: any order that is delivered or in flight with NO
-- recorded payment. Manually confirmed deliveries ("mark delivered by admin") are expected here
-- and are labelled in result->>'manualConfirmation'.
-- select reference, order_no, status, fulfillment_status, payment_verified_at, payment_amount,
--        result->>'manualConfirmation' as manual
--   from orders
--  where (fulfilled = true or fulfillment_status in ('processing','queued_with_provider'))
--    and (payment_verified_at is null or coalesce(payment_amount, 0) <= 0)
--  order by created_at desc;
