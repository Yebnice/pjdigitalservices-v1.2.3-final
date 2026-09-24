-- v1.3.0: adds app_settings, a small generic key/value table used to
-- persist background-job state across cron runs — specifically, when the
-- Techlink low-balance alert was last sent, so /api/jobs/fulfill (runs
-- every 5 minutes) doesn't re-alert the admin every single run while the
-- wallet balance stays low. Safe to run on an existing project; this is
-- already folded into the bottom of schema.sql too, so a fresh project
-- running schema.sql doesn't need to run this file separately.

create table if not exists app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
-- Same production security model as every other table: server-side
-- Supabase secret access only, no public policies.
