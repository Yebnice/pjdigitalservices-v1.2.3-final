-- PjDigitalServices v1.3.2 migration
-- Apply to an existing production Supabase database.
-- Safe to run repeatedly.

alter table customers
  add column if not exists verification_sent_at timestamptz;

create index if not exists customers_verification_token_idx
  on customers (verification_token)
  where verification_token is not null;

create index if not exists customers_reset_token_idx
  on customers (reset_token)
  where reset_token is not null;

alter table audit_log enable row level security;
alter table reviews enable row level security;
alter table app_settings enable row level security;

create index if not exists audit_log_reference_idx
  on audit_log (reference)
  where reference is not null;

create index if not exists reviews_order_reference_idx
  on reviews (order_reference);

create index if not exists app_settings_updated_at_idx
  on app_settings (updated_at desc);
