-- Fermentation tank assignments: which batch is in which tank.
-- Brewfather has no tank concept, so assignments live entirely in the app.
-- Tanks are fixed: 1..6.

create table if not exists tank_assignments (
  id uuid primary key default gen_random_uuid(),
  tank_number int not null check (tank_number between 1 and 6),
  batch_id uuid not null references batches(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  volume_in_bbl numeric null,   -- barrels of wort racked into the tank
  volume_out_bbl numeric null,  -- barrels yielded when racked out
  created_at timestamptz not null default now()
);

-- One current batch per tank, and one current tank per batch.
create unique index if not exists uq_tank_current
  on tank_assignments(tank_number) where released_at is null;
create unique index if not exists uq_batch_current
  on tank_assignments(batch_id) where released_at is null;
create index if not exists idx_tank_assignments_batch
  on tank_assignments(batch_id);

alter table tank_assignments enable row level security;
drop policy if exists "temp open access" on tank_assignments;
create policy "temp open access" on tank_assignments
  for all to anon, authenticated using (true) with check (true);
