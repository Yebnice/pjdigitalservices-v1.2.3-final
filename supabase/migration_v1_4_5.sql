-- PjDigitalServices v1.4.5 database hardening.
-- This migration mirrors the already-verified production state:
--   1) Pin the payment-before-delivery trigger search_path.
--   2) Add explicit restrictive deny policies to server-only public tables.
--   3) Remove the redundant non-unique reviews.order_reference index; the
--      unique index remains and is the canonical lookup + uniqueness guard.
--
-- Safe to rerun. No customer/business data is modified.

alter function public.orders_require_payment_before_delivery()
  set search_path = '';

do $$
declare
  t text;
  policy_name constant text := 'deny_client_access';
begin
  foreach t in array array[
    'app_settings',
    'audit_log',
    'customers',
    'feedback',
    'orders',
    'paystack_webhook_events',
    'reviews'
  ]
  loop
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = t
        and policyname = policy_name
    ) then
      execute format(
        'create policy %I on public.%I as restrictive for all to public using (false) with check (false)',
        policy_name, t
      );
    end if;
  end loop;
end
$$;

drop index if exists public.reviews_order_reference_idx;
