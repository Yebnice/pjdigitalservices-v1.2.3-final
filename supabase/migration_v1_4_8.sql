-- PjDigitalServices v1.4.8
-- Fix the database delivery guard so a genuinely paid order can transition
-- from payment_verified/processing to the final success/fulfilled state.
-- The previous live trigger rejected markFulfilled() because it required
-- status='payment_verified' even after the application correctly changed the
-- status to 'success'. No pricing or payment acceptance rule changes.

create or replace function public.orders_require_payment_before_delivery()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.fulfillment_status in ('ready', 'processing', 'queued_with_provider') then
    if new.status is distinct from 'payment_verified' or new.payment_verified_at is null then
      raise exception 'Order % cannot enter delivery state: no verified payment is recorded for it.', new.reference
        using errcode = '23514';
    end if;
  end if;

  if new.fulfillment_status = 'fulfilled' or new.fulfilled = true then
    if new.status is distinct from 'success' or new.payment_verified_at is null then
      raise exception 'Order % cannot enter delivery state: no verified payment is recorded for it.', new.reference
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;

notify pgrst, 'reload schema';
