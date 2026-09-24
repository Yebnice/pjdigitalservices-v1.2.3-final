-- PjDigitalServices v1.2.6 production-hardening migration.
-- Safe for an existing database. Run after migration_v1_2_5.sql.

alter table orders add column if not exists provider_cost numeric;
alter table orders add column if not exists customer_product_amount numeric;
alter table orders add column if not exists business_markup_amount numeric;
alter table orders add column if not exists idempotency_key text;
create unique index if not exists orders_idempotency_key_uq on orders (idempotency_key) where idempotency_key is not null;
create index if not exists orders_queued_provider_idx on orders (fulfillment_status, created_at) where fulfillment_status = 'queued_with_provider';
