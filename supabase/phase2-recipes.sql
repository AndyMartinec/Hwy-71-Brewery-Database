-- Highway 71 Ops — Phase 2: recipes (full ingredient bills from Brewfather),
-- batch cost sheets, and recipe-linked brew days.
-- Run once in the Supabase SQL Editor (after phase1-invoices.sql).

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  brewfather_id text unique,
  name text not null,
  style text,
  batch_size_gal numeric,
  og numeric,
  fg numeric,
  abv numeric,
  ibu numeric,
  -- Normalized ingredient bill:
  -- [{name, category: grain|hops|yeast|adjunct, amount, unit, note}]
  ingredients jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Brew days started from a recipe link back to it.
alter table batches add column if not exists recipe_id uuid references recipes(id);

alter table recipes enable row level security;
drop policy if exists "temp open access" on recipes;
create policy "temp open access" on recipes
  for all to anon, authenticated using (true) with check (true);
