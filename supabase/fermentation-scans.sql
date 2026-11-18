-- Highway 71 Ops — Fermentation sheet scanning.
-- Run once in the Supabase SQL Editor.
-- Flow: photo/PDF of a fermentation log sheet -> vision extraction ->
-- DRAFT scan with one row per reading (date, °Plato, temp) matched to a
-- batch -> review -> POST converts Plato to SG and writes
-- fermentation_readings. Nothing touches readings until posting.

create table if not exists fermentation_scans (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft' check (status in ('draft', 'posted')),
  file_path text,                           -- Supabase Storage path (bucket: fermentation-sheets)
  file_name text,
  created_at timestamptz not null default now()
);

create table if not exists fermentation_scan_lines (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references fermentation_scans(id) on delete cascade,
  batch_id uuid references batches(id),     -- matched batch (null until resolved in review)
  batch_label text,                          -- batch identifier exactly as printed on the sheet
  taken_at date,
  plato numeric,                             -- gravity in degrees Plato, as printed
  temp_f numeric,
  note text
);
create index if not exists idx_ferm_scan_lines_scan on fermentation_scan_lines(scan_id);

-- Cellar action per row, in plain English (e.g. "Dry-hopped with 1 lb Azacca").
alter table fermentation_scan_lines add column if not exists action text;

-- Gravity in degrees Plato, as printed on the sheet (gravity column keeps SG).
alter table fermentation_readings add column if not exists plato numeric;

alter table fermentation_scans enable row level security;
alter table fermentation_scan_lines enable row level security;
drop policy if exists "temp open access" on fermentation_scans;
create policy "temp open access" on fermentation_scans
  for all to anon, authenticated using (true) with check (true);
drop policy if exists "temp open access" on fermentation_scan_lines;
create policy "temp open access" on fermentation_scan_lines
  for all to anon, authenticated using (true) with check (true);

-- ── Storage bucket for original sheet files ──────────────────────────
insert into storage.buckets (id, name, public)
values ('fermentation-sheets', 'fermentation-sheets', false)
on conflict (id) do nothing;

drop policy if exists "fermentation-sheets bucket access" on storage.objects;
create policy "fermentation-sheets bucket access" on storage.objects
  for all to anon, authenticated
  using (bucket_id = 'fermentation-sheets')
  with check (bucket_id = 'fermentation-sheets');
