-- Highway 71 Ops — Brewfather Custom Stream push log (Nov 16, 2026).
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- When a fermentation scan posts, the newest reading for each tank is sent
-- to Brewfather's Custom Stream (one device per tank, "Tank 3"). Brewfather
-- takes at most one reading per device every 15 minutes, so every attempt
-- is logged here: the app checks it before sending, and the tank page shows
-- the last result. Without this table pushes still work, just unthrottled.

create table if not exists brewfather_stream_log (
  id uuid primary key default gen_random_uuid(),
  tank_number int not null,
  batch_id uuid references batches(id) on delete set null,
  reading_id uuid references fermentation_readings(id) on delete set null,
  status text not null check (status in ('sent', 'failed')),
  detail text,
  pushed_at timestamptz not null default now()
);
create index if not exists idx_bf_stream_tank on brewfather_stream_log(tank_number, pushed_at desc);

alter table brewfather_stream_log enable row level security;
drop policy if exists "temp open access" on brewfather_stream_log;
create policy "temp open access" on brewfather_stream_log
  for all to anon, authenticated using (true) with check (true);
