-- Highway 71 Ops — Phase 1: ingredient costs, expanded categories, invoice intake.
-- Run once in the Supabase SQL Editor (after schema.sql + temp-open-access.sql).

-- ── Ingredients: cost per unit + wider category list ──────────────────
alter table ingredients add column if not exists cost_per_unit numeric;

alter table ingredients drop constraint if exists ingredients_category_check;
alter table ingredients add constraint ingredients_category_check
  check (category in (
    'grain','adjunct','hops','yeast',
    'water','fining','acid','fruit','cleaning','gas','packaging','other'
  ));

-- ── Ledger: record the price paid on purchase movements ───────────────
alter table inventory_transactions add column if not exists unit_cost numeric;

-- ── Stock view: include cost + inventory value ────────────────────────
-- (New view columns must be appended at the end — Postgres rule.)
create or replace view ingredient_stock as
  select i.id, i.name, i.category, i.supplier, i.unit, i.low_stock_threshold,
         coalesce(sum(t.qty_change), 0) as on_hand,
         i.cost_per_unit,
         case when i.cost_per_unit is null then null
              else coalesce(sum(t.qty_change), 0) * i.cost_per_unit end as inventory_value
  from ingredients i
  left join inventory_transactions t on t.ingredient_id = i.id
  group by i.id;

-- ── Invoices ──────────────────────────────────────────────────────────
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  supplier text,
  invoice_number text,
  invoice_date date,
  freight numeric not null default 0,
  tax numeric not null default 0,
  total numeric,
  file_path text,                            -- Supabase Storage path (bucket: invoices)
  file_name text,
  status text not null default 'draft' check (status in ('draft','posted')),
  created_by uuid,
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

create table if not exists invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  raw_name text not null,                    -- product name exactly as printed
  qty numeric,                               -- quantity as printed
  unit text,                                 -- unit as printed (lb, bag, case…)
  unit_price numeric,                        -- price per printed unit
  line_total numeric,
  ingredient_id uuid references ingredients(id),  -- matched ingredient (null = unmatched)
  qty_to_add numeric,                        -- qty in the ingredient's own unit (defaults to qty)
  -- set when the line should create a brand-new ingredient on posting:
  new_name text,
  new_category text,
  new_unit text,
  created_at timestamptz not null default now()
);
create index if not exists idx_invoice_lines_invoice on invoice_lines(invoice_id);

-- Learned supplier-item → ingredient matches (from confirmed invoices).
create table if not exists supplier_item_matches (
  id uuid primary key default gen_random_uuid(),
  supplier text not null,
  raw_name_normalized text not null,
  ingredient_id uuid not null references ingredients(id),
  unique (supplier, raw_name_normalized)
);

alter table invoices enable row level security;
alter table invoice_lines enable row level security;
alter table supplier_item_matches enable row level security;

-- Access policies match the app's current posture (see temp-open-access.sql).
do $$
declare t text;
begin
  foreach t in array array['invoices','invoice_lines','supplier_item_matches']
  loop
    execute format('drop policy if exists "temp open access" on %I', t);
    execute format(
      'create policy "temp open access" on %I
       for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ── Storage bucket for original invoice files ─────────────────────────
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

drop policy if exists "invoices bucket access" on storage.objects;
create policy "invoices bucket access" on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'invoices')
  with check (bucket_id = 'invoices');
