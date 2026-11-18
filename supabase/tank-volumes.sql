-- Tank racking volumes + decimal finished-beer quantities.
-- Run AFTER supabase/tanks.sql (both files are idempotent; keep this order).

-- Barrels of wort in / barrels yielded, for installs that ran tanks.sql
-- before these columns existed.
alter table tank_assignments add column if not exists volume_in_bbl numeric;
alter table tank_assignments add column if not exists volume_out_bbl numeric;

-- Quantities go decimal (harmless for integer keg counts; future-proof).
-- The finished_stock view must be dropped before the column type can change,
-- then recreated.
drop view if exists finished_stock;

alter table finished_goods_transactions
  alter column qty_change type numeric using qty_change::numeric;

create or replace view finished_stock as
  select beer_name, package_type, coalesce(sum(qty_change), 0) as on_hand
  from finished_goods_transactions
  group by beer_name, package_type;
