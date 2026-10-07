-- v1.4.9: reconcile the payment-before-delivery guard with the live database.
-- Safe/idempotent: no order data is changed.
create or replace function public.orders_require_payment_before_delivery()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if (
       new.fulfilled = true
       or new.fulfillment_status in ('ready','processing','queued_with_provider','fulfilled')
     )
     and (
       new.payment_verified_at is null
       or (new.fulfillment_status = 'fulfilled' and new.status is distinct from 'success')
       or (new.fulfillment_status in ('ready','processing','queued_with_provider') and new.status is distinct from 'payment_verified')
     )
  then
    raise exception 'Order % cannot enter delivery state: no verified payment is recorded for it.', new.reference
      using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists orders_require_payment_before_delivery on public.orders;
create trigger orders_require_payment_before_delivery
before insert or update on public.orders
for each row execute function public.orders_require_payment_before_delivery();
