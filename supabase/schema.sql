-- PjDigitalServices production schema.
-- Paste this whole file into Supabase -> SQL Editor -> Run. It is fully
-- idempotent: on a fresh project it creates everything; on an existing
-- project it only adds what is missing (the "orders column catch-up" block
-- near the bottom) and never touches your data.
create extension if not exists pgcrypto;

create table if not exists orders (
  reference             text primary key,
  order_type            text not null,
  network               text,
  phone                 text not null,
  email                 text not null,
  amount                numeric not null,
  provider_cost         numeric,
  checkout_amount       numeric,
  paystack_fee_amount   numeric,
  customer_product_amount numeric,
  business_markup_amount numeric,
  idempotency_key       text,
  bundle_id             text,
  afa_details           jsonb,
  meter_number          text,
  tv_details            jsonb,
  checker_details       jsonb,
  tier_details          jsonb,
  status                text not null default 'pending',
  fulfilled             boolean not null default false,
  fulfillment_status    text not null default 'pending',
  fulfillment_attempts  integer not null default 0,
  processing_started_at   timestamptz,
  last_fulfillment_error text,
  payment_verified_at   timestamptz,
  payment_amount       numeric,
  result                jsonb,
  fail_reason           text,
  created_at            timestamptz not null default now(),
  fulfilled_at          timestamptz,
  manual_review_notified_at timestamptz,
  customer_delay_notified_at timestamptz,
  manual_review_at        timestamptz,
  manual_review_resolution text,
  manual_review_resolved_at timestamptz,
  urgent_review_notified_at timestamptz,
  queued_alert_sent_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- orders column catch-up (v1.3.1). Placed right after the orders table on
-- purpose, BEFORE any index that references these columns. Idempotent: `add column if not exists`
-- does nothing where the column is already there, so re-running this file on
-- an existing project brings an older `orders` table up to date without the
-- separate migration files. (`create table if not exists orders` above skips
-- an existing table entirely, so newer columns must be added here.)
-- ---------------------------------------------------------------------------
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
-- v1.3.1: set when the admin has been alerted that a queued order has waited
-- too long (QUEUED_ALERT_MINUTES), so each order alerts once.
alter table orders add column if not exists queued_alert_sent_at timestamptz;

-- Indexes used by the cron worker (/api/jobs/fulfill).
create unique index if not exists orders_idempotency_key_uq on orders (idempotency_key) where idempotency_key is not null;
create index if not exists orders_queued_provider_idx on orders (fulfillment_status, created_at) where fulfillment_status = 'queued_with_provider';
create index if not exists orders_manual_review_idx on orders (manual_review_at) where fulfillment_status = 'manual_review' and fulfilled = false and urgent_review_notified_at is null;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text unique not null,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  case_reference text unique not null,
  name text not null,
  email text,
  phone text,
  order_reference text,
  category text not null default 'general',
  message text not null,
  service_type text,
  transaction_id text,
  transaction_amount numeric,
  requested_data text,
  beneficiary text,
  transaction_at timestamptz,
  transaction_details text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create index if not exists orders_email_idx on orders (lower(email));
create index if not exists orders_phone_idx on orders (phone);
create index if not exists orders_fulfillment_idx on orders (fulfilled, fulfillment_status, created_at);
create index if not exists orders_created_at_idx on orders (created_at desc);
create unique index if not exists orders_idempotency_key_uq on orders (idempotency_key) where idempotency_key is not null;
create index if not exists feedback_created_at_idx on feedback (created_at desc);

alter table orders enable row level security;
alter table customers enable row level security;
alter table feedback enable row level security;

-- Production security model: the application uses server-side Supabase secret
-- access only. No public table policies are intentionally granted here.

-- Existing-project migration (safe/idempotent):
-- alter table feedback add column if not exists case_reference text;
alter table feedback add column if not exists service_type text;
alter table feedback add column if not exists transaction_id text;
alter table feedback add column if not exists transaction_amount numeric;
alter table feedback add column if not exists requested_data text;
alter table feedback add column if not exists beneficiary text;
alter table feedback add column if not exists transaction_at timestamptz;
alter table feedback add column if not exists transaction_details text;

-- Centralized admin action trail. Note: since the app currently uses one
-- shared ADMIN_PASSWORD rather than individual admin logins, `actor` will
-- always read "admin" — this records WHAT happened and WHEN, not WHICH
-- person, unless the app later adds named admin accounts.
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor text not null default 'admin',
  action text not null,
  reference text,
  note text
);
create index if not exists audit_log_created_at_idx on audit_log (created_at desc);

-- Real customer accounts: password + username + email verification +
-- password reset, added on top of the existing autofill-only customers
-- table. Existing rows (from the old "just remember my details" flow)
-- simply have null values here — they are not real login-capable accounts
-- until someone registers properly with a password.
alter table customers add column if not exists username text unique;
alter table customers add column if not exists password_hash text;
alter table customers add column if not exists email_verified boolean not null default false;
alter table customers add column if not exists verification_token text;
alter table customers add column if not exists verification_expires_at timestamptz;
alter table customers add column if not exists reset_token text;
alter table customers add column if not exists reset_expires_at timestamptz;

-- Public customer reviews, tied to a real completed order so only actual
-- purchasers can leave one. is_hidden lets admin moderate without
-- permanently deleting the record.
create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  order_reference text not null,
  customer_name text not null,
  rating integer not null check (rating >= 1 and rating <= 5),
  comment text,
  service_type text,
  is_hidden boolean not null default false
);
create index if not exists reviews_created_at_idx on reviews (created_at desc);
alter table reviews enable row level security;

-- Small generic key/value store for background-job state that needs to
-- persist BETWEEN cron runs (e.g. "when did we last alert about a low
-- Techlink wallet balance", so /api/jobs/fulfill — which runs every 5
-- minutes — doesn't re-send that alert every single run while the balance
-- stays low). This is exactly the kind of state the in-memory rateLimit()
-- in lib/rateLimit.js can't hold across serverless invocations; a tiny
-- Supabase table is the fix for that specific problem, not a general
-- replacement for it.
create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
-- Same production security model as every other table here: server-side
-- Supabase secret access only, no public policies.

-- Existing rows should be backfilled with unique SUP-YYYYMMDD-XXXXX references before adding a NOT NULL/UNIQUE constraint.
-- alter table orders add column if not exists fulfillment_status text not null default 'pending';
-- alter table orders add column if not exists fulfillment_attempts integer not null default 0;
-- alter table orders add column if not exists processing_started_at timestamptz;
-- alter table orders add column if not exists manual_review_notified_at timestamptz;
-- alter table orders add column if not exists customer_delay_notified_at timestamptz;
-- alter table orders add column if not exists last_fulfillment_error text;
-- alter table orders add column if not exists payment_verified_at timestamptz;
-- alter table orders add column if not exists payment_amount numeric;
-- alter table orders add column if not exists manual_review_at timestamptz;
-- alter table orders add column if not exists manual_review_resolution text;
-- alter table orders add column if not exists manual_review_resolved_at timestamptz;
-- alter table orders add column if not exists urgent_review_notified_at timestamptz;
-- (Existing projects: these are already applied by migration_v1_2.sql / migration_v1_2_2.sql — this block is reference documentation, not meant to be re-run.)
-- update orders set fulfillment_status = case when fulfilled then 'fulfilled' else 'pending' end where fulfillment_status is null;
-- create index if not exists orders_fulfillment_idx on orders (fulfilled, fulfillment_status, created_at);
