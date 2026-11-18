-- Reports (Nov 5, 2026) — the two small gaps the Reports page needs.
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- 1. tap_events: a keg going ON TAP is not a sale and must not touch
--    finished stock. Tapping moves a keg to the tap; selling empties it.
--    Poured volume = kegs tapped x size; sold = kegs logged sold;
--    variance = poured - sold. Until Toast lands, this is the poured number.
-- 2. approval_ref on finished_goods_transactions: destroyed beer is only
--    tax-exempt with TABC pre-approval. The reference goes here so the
--    Reports page can flag destructions filed without one.

create table if not exists tap_events (
  id uuid primary key default gen_random_uuid(),
  beer_name text not null,
  package_type text not null,               -- 'Half-barrel keg', 'Sixth-barrel keg', …
  qty integer not null check (qty > 0),     -- kegs/cases tapped
  batch_id uuid references batches(id),
  tapped_at timestamptz not null default now(),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_tap_beer on tap_events(beer_name, tapped_at);
create index if not exists idx_tap_created on tap_events(created_at desc);

alter table finished_goods_transactions
  add column if not exists approval_ref text;

alter table tap_events enable row level security;
drop policy if exists "temp open access" on tap_events;
create policy "temp open access" on tap_events
  for all to anon, authenticated using (true) with check (true);
