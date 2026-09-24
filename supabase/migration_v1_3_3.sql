-- PjDigitalServices v1.3.3 migration
-- Durable Paystack webhook queue.
-- Safe to run repeatedly.

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

create unique index if not exists paystack_webhook_event_reference_uq
  on paystack_webhook_events (event_type, reference);

create index if not exists paystack_webhook_pending_idx
  on paystack_webhook_events (status, available_at, received_at)
  where status = 'pending';

alter table paystack_webhook_events enable row level security;
