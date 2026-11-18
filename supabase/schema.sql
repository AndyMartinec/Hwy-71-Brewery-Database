-- Highway 71 Brewing — operations database (v1)
-- Run once in the Supabase SQL editor. All inventory movement is append-only:
-- current stock is always derived from the ledger, never stored directly.

-- ── Raw material catalog ──────────────────────────────────────────────
create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null check (category in ('grain','adjunct','hops','yeast','other')),
  supplier text,
  unit text not null default 'lb',
  low_stock_threshold numeric,
  created_at timestamptz not null default now()
);

-- ── Batches (brew log). brewfather_id links to Brewfather's _id. ─────
create table if not exists batches (
  id uuid primary key default gen_random_uuid(),
  brewfather_id text unique,
  batch_number text,
  recipe_name text not null,
  status text not null default 'Planning'
    check (status in ('Planning','Brewing','Fermenting','Conditioning','Completed','Archived')),
  brew_date date,
  batch_size_gal numeric,
  brewer text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Raw-material ledger (append-only) ─────────────────────────────────
create table if not exists inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ingredients(id),
  qty_change numeric not null,              -- positive = received, negative = used
  unit text not null default 'lb',
  reason text not null
    check (reason in ('opening','purchase','brew_usage','adjustment','spoilage')),
  batch_id uuid references batches(id),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_inv_txn_ingredient on inventory_transactions(ingredient_id);
create index if not exists idx_inv_txn_created on inventory_transactions(created_at desc);

-- ── Fermentation sheet readings ───────────────────────────────────────
create table if not exists fermentation_readings (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id) on delete cascade,
  taken_at timestamptz not null default now(),
  gravity numeric,                          -- specific gravity, e.g. 1.052
  temp_f numeric,
  ph numeric,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_ferm_batch on fermentation_readings(batch_id, taken_at);

-- ── Finished-beer ledger (append-only; kegs, cases, …) ────────────────
create table if not exists finished_goods_transactions (
  id uuid primary key default gen_random_uuid(),
  beer_name text not null,
  package_type text not null,               -- 'Half-barrel keg', 'Sixth-barrel keg', …
  qty_change integer not null,              -- positive = packaged/received, negative = sold/removed
  reason text not null
    check (reason in ('opening','packaged','sold','adjustment','destroyed','returned')),
  channel text
    check (channel in ('retail','on_premise','off_premise','distributor')),
  batch_id uuid references batches(id),
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_fg_beer on finished_goods_transactions(beer_name, package_type);
create index if not exists idx_fg_created on finished_goods_transactions(created_at desc);

-- ── Packaging runs: batch → packages (drives TABC Schedule 1 gallons) ─
create table if not exists packaging_runs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references batches(id),
  packaged_at timestamptz not null default now(),
  package_type text not null,
  qty integer not null,
  gallons numeric,                          -- total gallons packaged
  note text,
  created_at timestamptz not null default now()
);

-- ── Derived stock views ───────────────────────────────────────────────
create or replace view ingredient_stock as
  select i.id, i.name, i.category, i.supplier, i.unit, i.low_stock_threshold,
         coalesce(sum(t.qty_change), 0) as on_hand
  from ingredients i
  left join inventory_transactions t on t.ingredient_id = i.id
  group by i.id;

create or replace view finished_stock as
  select beer_name, package_type,
         coalesce(sum(qty_change), 0)::int as on_hand
  from finished_goods_transactions
  group by beer_name, package_type;

-- ── Row-level security: any signed-in user has full access (v1) ───────
alter table ingredients enable row level security;
alter table batches enable row level security;
alter table inventory_transactions enable row level security;
alter table fermentation_readings enable row level security;
alter table finished_goods_transactions enable row level security;
alter table packaging_runs enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'ingredients','batches','inventory_transactions',
    'fermentation_readings','finished_goods_transactions','packaging_runs']
  loop
    execute format(
      'drop policy if exists "authenticated full access" on %I', t);
    execute format(
      'create policy "authenticated full access" on %I
       for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
