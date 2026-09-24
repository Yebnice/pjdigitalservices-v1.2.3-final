-- PjDigitalServices production database schema.
-- Version: v1.3.3
--
-- SOURCE OF TRUTH:
-- This file matches the current application code on the main branch.
-- It is intentionally idempotent: it creates missing tables/columns/indexes
-- and does not delete or overwrite existing business data.
--
-- Existing deployments:
--   1) Paste/run this whole file in Supabase SQL Editor.
--   2) It is safe to run more than once.
--
-- Security model:
-- The application uses server-side Supabase access only. RLS is enabled and
-- no public table policies are created here.

create extension if not exists pgcrypto;


-- ============================================================
-- PAYSTACK WEBHOOK QUEUE
-- ============================================================

create table if not exists paystack_webhook_events (
  id            uuid primary key default gen_random_uuid(),
  event_key     text not null unique,
  event_type    text not null,
  reference     text not null,
  payload       jsonb not null,
  status        text not null default 'pending',
  attempts      integer not null default 0,
  received_at   timestamptz not null default now(),
  available_at  timestamptz not null default now(),
  locked_at     timestamptz,
  processed_at  timestamptz,
  last_error    text
);

alter table paystack_webhook_events add column if not exists event_key text;
alter table paystack_webhook_events add column if not exists event_type text;
alter table paystack_webhook_events add column if not exists reference text;
alter table paystack_webhook_events add column if not exists payload jsonb;
alter table paystack_webhook_events add column if not exists status text default 'pending';
alter table paystack_webhook_events add column if not exists attempts integer default 0;
alter table paystack_webhook_events add column if not exists received_at timestamptz default now();
alter table paystack_webhook_events add column if not exists available_at timestamptz default now();
alter table paystack_webhook_events add column if not exists locked_at timestamptz;
alter table paystack_webhook_events add column if not exists processed_at timestamptz;
alter table paystack_webhook_events add column if not exists last_error text;

create unique index if not exists paystack_webhook_event_reference_uq
  on paystack_webhook_events (event_type, reference);

create index if not exists paystack_webhook_pending_idx
  on paystack_webhook_events (status, available_at, received_at)
  where status = 'pending';

alter table paystack_webhook_events enable row level security;


-- ============================================================
-- ORDERS
-- ============================================================

create table if not exists orders (
  reference                 text primary key,
  order_type                text not null,
  network                   text,
  phone                     text not null,
  email                     text not null,
  amount                    numeric not null,
  provider_cost             numeric,
  checkout_amount           numeric,
  paystack_fee_amount       numeric,
  customer_product_amount   numeric,
  business_markup_amount    numeric,
  idempotency_key            text,
  bundle_id                  text,
  afa_details                jsonb,
  meter_number               text,
  tv_details                jsonb,
  checker_details           jsonb,
  tier_details               jsonb,
  status                     text not null default 'pending',
  fulfilled                  boolean not null default false,
  fulfillment_status        text not null default 'pending',
  fulfillment_attempts      integer not null default 0,
  processing_started_at     timestamptz,
  last_fulfillment_error    text,
  payment_verified_at        timestamptz,
  payment_amount             numeric,
  result                     jsonb,
  fail_reason                text,
  created_at                 timestamptz not null default now(),
  fulfilled_at               timestamptz,
  manual_review_notified_at  timestamptz,
  customer_delay_notified_at timestamptz,
  manual_review_at           timestamptz,
  manual_review_resolution   text,
  manual_review_resolved_at  timestamptz,
  urgent_review_notified_at  timestamptz,
  queued_alert_sent_at       timestamptz
);

-- Existing-project catch-up. create table if not exists does NOT add new
-- columns to an older orders table, so every newer field is added explicitly.

alter table orders add column if not exists provider_cost numeric;
alter table orders add column if not exists checkout_amount numeric;
alter table orders add column if not exists paystack_fee_amount numeric;
alter table orders add column if not exists customer_product_amount numeric;
alter table orders add column if not exists business_markup_amount numeric;
alter table orders add column if not exists idempotency_key text;
alter table orders add column if not exists bundle_id text;
alter table orders add column if not exists afa_details jsonb;
alter table orders add column if not exists meter_number text;
alter table orders add column if not exists tv_details jsonb;
alter table orders add column if not exists checker_details jsonb;
alter table orders add column if not exists tier_details jsonb;
alter table orders add column if not exists fulfillment_status text not null default 'pending';
alter table orders add column if not exists fulfillment_attempts integer not null default 0;
alter table orders add column if not exists processing_started_at timestamptz;
alter table orders add column if not exists last_fulfillment_error text;
alter table orders add column if not exists payment_verified_at timestamptz;
alter table orders add column if not exists payment_amount numeric;
alter table orders add column if not exists result jsonb;
alter table orders add column if not exists fail_reason text;
alter table orders add column if not exists fulfilled_at timestamptz;
alter table orders add column if not exists manual_review_notified_at timestamptz;
alter table orders add column if not exists customer_delay_notified_at timestamptz;
alter table orders add column if not exists manual_review_at timestamptz;
alter table orders add column if not exists manual_review_resolution text;
alter table orders add column if not exists manual_review_resolved_at timestamptz;
alter table orders add column if not exists urgent_review_notified_at timestamptz;
alter table orders add column if not exists queued_alert_sent_at timestamptz;


-- ============================================================
-- CUSTOMERS / REAL CUSTOMER ACCOUNTS
-- ============================================================

create table if not exists customers (
  id                       uuid primary key default gen_random_uuid(),
  name                     text,
  email                    text unique not null,
  phone                    text,
  created_at               timestamptz not null default now()
);

alter table customers add column if not exists username text unique;
alter table customers add column if not exists password_hash text;
alter table customers add column if not exists email_verified boolean not null default false;
alter table customers add column if not exists verification_token text;
alter table customers add column if not exists verification_expires_at timestamptz;

-- v1.3.2: used by /api/auth/resend-verification to enforce the persisted
-- 10-minute resend cooldown across serverless invocations.
alter table customers add column if not exists verification_sent_at timestamptz;

alter table customers add column if not exists reset_token text;
alter table customers add column if not exists reset_expires_at timestamptz;


-- ============================================================
-- CUSTOMER FEEDBACK / SUPPORT CASES
-- ============================================================

create table if not exists feedback (
  id                    uuid primary key default gen_random_uuid(),
  case_reference        text unique not null,
  name                  text not null,
  email                 text,
  phone                 text,
  order_reference       text,
  category              text not null default 'general',
  message               text not null,
  service_type          text,
  transaction_id        text,
  transaction_amount    numeric,
  requested_data        text,
  beneficiary           text,
  transaction_at        timestamptz,
  transaction_details   text,
  status                text not null default 'open',
  created_at            timestamptz not null default now()
);

alter table feedback add column if not exists case_reference text;
alter table feedback add column if not exists service_type text;
alter table feedback add column if not exists transaction_id text;
alter table feedback add column if not exists transaction_amount numeric;
alter table feedback add column if not exists requested_data text;
alter table feedback add column if not exists beneficiary text;
alter table feedback add column if not exists transaction_at timestamptz;
alter table feedback add column if not exists transaction_details text;
alter table feedback add column if not exists status text default 'open';
alter table feedback add column if not exists created_at timestamptz default now();


-- ============================================================
-- REVIEWS
-- ============================================================

create table if not exists reviews (
  id               uuid primary key default gen_random_uuid(),
  created_at       timestamptz not null default now(),
  order_reference  text not null,
  customer_name    text not null,
  rating           integer not null check (rating >= 1 and rating <= 5),
  comment          text,
  service_type     text,
  is_hidden        boolean not null default false
);


-- ============================================================
-- ADMIN AUDIT LOG
-- ============================================================

create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  actor       text not null default 'admin',
  action      text not null,
  reference   text,
  note        text
);


-- ============================================================
-- PERSISTENT BACKGROUND-JOB STATE
-- ============================================================

create table if not exists app_settings (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now()
);


-- ============================================================
-- INDEXES
-- ============================================================

create unique index if not exists orders_idempotency_key_uq
  on orders (idempotency_key)
  where idempotency_key is not null;

create index if not exists orders_email_idx
  on orders (lower(email));

create index if not exists orders_phone_idx
  on orders (phone);

create index if not exists orders_fulfillment_idx
  on orders (fulfilled, fulfillment_status, created_at);

create index if not exists orders_payment_state_idx
  on orders (status, fulfillment_status, created_at);

create index if not exists orders_created_at_idx
  on orders (created_at desc);

create index if not exists orders_queued_provider_idx
  on orders (fulfillment_status, created_at)
  where fulfillment_status = 'queued_with_provider';

create index if not exists orders_manual_review_idx
  on orders (manual_review_at)
  where fulfillment_status = 'manual_review'
    and fulfilled = false
    and urgent_review_notified_at is null;

create index if not exists customers_verification_token_idx
  on customers (verification_token)
  where verification_token is not null;

create index if not exists customers_reset_token_idx
  on customers (reset_token)
  where reset_token is not null;

create index if not exists feedback_created_at_idx
  on feedback (created_at desc);

create index if not exists feedback_order_reference_idx
  on feedback (order_reference)
  where order_reference is not null;

create index if not exists feedback_transaction_id_idx
  on feedback (transaction_id)
  where transaction_id is not null;

create index if not exists reviews_created_at_idx
  on reviews (created_at desc);

create index if not exists reviews_order_reference_idx
  on reviews (order_reference);

create index if not exists audit_log_created_at_idx
  on audit_log (created_at desc);

create index if not exists audit_log_reference_idx
  on audit_log (reference)
  where reference is not null;

create index if not exists app_settings_updated_at_idx
  on app_settings (updated_at desc);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table orders enable row level security;
alter table customers enable row level security;
alter table feedback enable row level security;
alter table reviews enable row level security;
alter table audit_log enable row level security;
alter table app_settings enable row level security;


-- ============================================================
-- SAFE EXISTING-DATA NORMALIZATION
-- ============================================================

-- These updates only fill missing operational defaults; they do not change
-- completed business values or delete records.

update orders
set fulfillment_status = case
  when fulfilled = true then 'fulfilled'
  when fulfillment_status is null then 'pending'
  else fulfillment_status
end
where fulfillment_status is null
   or (fulfilled = true and fulfillment_status <> 'fulfilled');

update orders
set fulfillment_attempts = 0
where fulfillment_attempts is null;

-- Historical payment failures from pre-v1.3.4 used status='failed' and
-- fulfillment_status='failed'. Normalize only unfulfilled records that were
-- never payment-verified so they can never enter the fulfillment queue.
update orders
set
  status = 'payment_failed',
  fulfillment_status = 'pending'
where fulfilled = false
  and status = 'failed'
  and fulfillment_status = 'failed'
  and payment_verified_at is null;

update orders
set status = 'pending'
where status is null;

update orders
set created_at = now()
where created_at is null;


-- ============================================================
-- OPTIONAL VERIFICATION QUERIES
-- ============================================================

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'customers'
order by ordinal_position;

select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'orders'
order by ordinal_position;
