-- Highway 71 Ops — Taproom pint prices per beer (for margin calculation).
-- Run once in the Supabase SQL Editor (after phase2-recipes.sql).
-- One row per beer name; margin = (pint price − ingredient cost per pint)
-- ÷ pint price, using completed-batch costs.

create table if not exists beer_prices (
  beer_name text primary key,
  pint_price numeric not null check (pint_price > 0),
  updated_at timestamptz not null default now()
);

alter table beer_prices enable row level security;
drop policy if exists "temp open access" on beer_prices;
create policy "temp open access" on beer_prices
  for all to anon, authenticated using (true) with check (true);
