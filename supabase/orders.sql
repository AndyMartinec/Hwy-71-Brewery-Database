-- Ingredient orders (Nov 5, 2026) — brew-plan ordering.
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Flow: pick recipes x batches on /orders -> the app totals every
-- ingredient needed, subtracts what's on hand, and the shortfall becomes
-- the order. A saved order is a snapshot (quantities as ordered), so later
-- inventory moves never rewrite it. Status draft -> sent.

create table if not exists ingredient_orders (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft','sent')),
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table if not exists ingredient_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references ingredient_orders(id) on delete cascade,
  ingredient_id uuid references ingredients(id),
  ingredient_name text not null,
  supplier text,
  qty numeric not null,
  unit text not null default 'lb',
  unit_cost numeric,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_order_lines_order on ingredient_order_lines(order_id);

alter table ingredient_orders enable row level security;
alter table ingredient_order_lines enable row level security;
drop policy if exists "temp open access" on ingredient_orders;
create policy "temp open access" on ingredient_orders
  for all to anon, authenticated using (true) with check (true);
drop policy if exists "temp open access" on ingredient_order_lines;
create policy "temp open access" on ingredient_order_lines
  for all to anon, authenticated using (true) with check (true);
