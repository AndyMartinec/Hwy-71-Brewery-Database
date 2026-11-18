-- Highway 71 Brewing — opening inventory (counted Oct 19, 2026)
-- Run AFTER schema.sql in the Supabase SQL editor.

insert into ingredients (name, category, supplier, unit, low_stock_threshold) values
  ('IREKS Pilsner Malt', 'grain', 'IREKS', 'lb', 110),
  ('Pale Ale Malt', 'grain', 'Briess', 'lb', 110),
  ('Palisander Crystal Rosewood', 'grain', 'IREKS', 'lb', 10),
  ('CaraMunich Type II', 'grain', 'Weyermann', 'lb', 5),
  ('Caramel Malt 20L', 'grain', 'Briess', 'lb', 10),
  ('Carafa Special II', 'grain', 'Weyermann', 'lb', 10),
  ('Flaked Corn', 'adjunct', null, 'lb', 10),
  ('Dextrose', 'adjunct', null, 'lb', 25)
on conflict (name) do nothing;

insert into inventory_transactions (ingredient_id, qty_change, unit, reason, note)
select i.id, v.qty, 'lb', 'opening', 'Opening count Oct 19, 2026'
from ingredients i
join (values
  ('IREKS Pilsner Malt', 165),
  ('Pale Ale Malt', 275),
  ('Palisander Crystal Rosewood', 20),
  ('CaraMunich Type II', 5),
  ('Caramel Malt 20L', 25),
  ('Carafa Special II', 35),
  ('Flaked Corn', 25),
  ('Dextrose', 100)
) as v(name, qty) on v.name = i.name;

insert into finished_goods_transactions (beer_name, package_type, qty_change, reason, note)
values
  ('Pale Ale', 'Half-barrel keg', 7, 'opening', 'Opening count Oct 19, 2026'),
  ('Hilltop Haze', 'Half-barrel keg', 1, 'opening', 'Opening count Oct 19, 2026'),
  ('West Cypress', 'Half-barrel keg', 1, 'opening', 'Opening count Oct 19, 2026'),
  ('Hefeweizen', 'Half-barrel keg', 1, 'opening', 'Opening count Oct 19, 2026'),
  ('Lake Life Lager', 'Half-barrel keg', 3, 'opening', 'Opening count Oct 19, 2026'),
  ('Amber', 'Half-barrel keg', 3, 'opening', 'Opening count Oct 19, 2026'),
  ('La Brisa', 'Half-barrel keg', 6, 'opening', 'Opening count Oct 19, 2026'),
  ('Oktoberfest', 'Half-barrel keg', 4, 'opening', 'Opening count Oct 19, 2026');
