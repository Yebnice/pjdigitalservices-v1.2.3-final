-- ============================================================================
-- PjDigitalServices v1.4.0 migration
--   1. Order numbers: our own PJ-XXXXXXXX id, separate from the Paystack reference
--   2. Paystack transaction id + real fee columns (includes v1.3.7, safe to repeat)
--   3. LOCK the database: only the server (service_role) may touch your tables
-- Safe to run more than once. Run it BEFORE deploying the matching code.
-- Supabase: SQL Editor -> New query -> paste all -> Run.
-- ============================================================================

-- ---- 1 + 2. New order columns ----------------------------------------------
alter table orders add column if not exists paystack_fee_actual numeric;
alter table orders add column if not exists paystack_net_settled numeric;
alter table orders add column if not exists order_no text;
alter table orders add column if not exists paystack_transaction_id text;

-- Give every EXISTING order a number too (PJ-L0000001, PJ-L0000002, ... oldest
-- first). New orders get random PJ-XXXXXXXX numbers from the app. The "L" never
-- appears in a random number, so the two can never collide.
with numbered as (
  select reference, row_number() over (order by created_at, reference) as rn
  from orders
  where order_no is null
),
base as (
  select coalesce(max(substring(order_no from 5)::int), 0) as highest
  from orders
  where order_no ~ '^PJ-L[0-9]{7}$'
)
update orders o
set order_no = 'PJ-L' || lpad((base.highest + numbered.rn)::text, 7, '0')
from numbered, base
where o.reference = numbered.reference;

create unique index if not exists orders_order_no_uq on orders (order_no) where order_no is not null;
create index if not exists orders_paystack_txn_idx on orders (paystack_transaction_id) where paystack_transaction_id is not null;

-- ---- 3. Lock the database -----------------------------------------------------
-- The app only ever talks to Supabase with the SECRET (service_role) key, on the
-- server. The public "anon" and "authenticated" roles must never touch these
-- tables. Row Level Security already blocks them (it is on, with no policies);
-- taking the permissions away as well means a single mistake, such as someone
-- switching RLS off in the dashboard, still cannot expose orders, customers'
-- password hashes, or let anyone mark an order "paid".
alter table paystack_webhook_events enable row level security;
alter table orders                  enable row level security;
alter table customers               enable row level security;
alter table feedback                enable row level security;
alter table reviews                 enable row level security;
alter table audit_log               enable row level security;
alter table app_settings            enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Future tables, sequences and functions created in the SQL editor start locked too.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- Make the API pick up the new columns straight away.
notify pgrst, 'reload schema';
