-- PjDigitalServices v1.3.1 migration.
-- Safe to run on an existing database, and safe to run more than once.
-- (Re-running the full supabase/schema.sql does the same thing and more.)
--
-- 1. app_settings: from v1.3.0 (Techlink low-balance alert cooldown). Included
--    so an upgrade from ANY earlier version needs only this one file.
-- 2. orders.queued_alert_sent_at: new in v1.3.1 - remembers that the admin was
--    alerted about a queued order that has waited too long, so it alerts once.
-- 3. Two partial indexes used by the cron worker.

create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;

alter table orders add column if not exists queued_alert_sent_at timestamptz;

create index if not exists orders_queued_provider_idx
  on orders (fulfillment_status, created_at)
  where fulfillment_status = 'queued_with_provider';

create index if not exists orders_manual_review_idx
  on orders (manual_review_at)
  where fulfillment_status = 'manual_review' and fulfilled = false and urgent_review_notified_at is null;
