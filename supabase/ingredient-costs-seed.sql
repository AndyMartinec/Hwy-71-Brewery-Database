-- Placeholder ingredient costs from the Pro Brew Supply price list (Jan 2025).
--
-- Uses the NON-discounted single-bag $/lb price for each item. Grain and
-- adjunct costs in the app are per lb, so these map straight onto
-- ingredients.cost_per_unit.
--
-- SAFE TO RE-RUN: every statement only fills in ingredients that have NO
-- cost yet (cost_per_unit is null). It never overwrites a cost that came
-- from a real posted invoice. When a new invoice posts, the app blends the
-- invoice price into cost_per_unit as a weighted average automatically.
--
-- NOT covered by this sheet: hops (no hop prices listed), yeast (sold by
-- 500 g brick — doesn't map to per-pkg), Weyermann malts (not carried),
-- water chemistry / cleaning chemicals.
-- Run the report query at the bottom to see what's still missing.

-- ── His current on-hand inventory (exact matches first) ──────────────────

-- IREKS Pilsner Malt 165 lb
update ingredients set cost_per_unit = 0.80
where cost_per_unit is null
  and lower(name) like '%ireks%' and lower(name) like '%pilsner%';

-- Briess Pale Ale Malt 275 lb
update ingredients set cost_per_unit = 0.80
where cost_per_unit is null
  and lower(name) like '%briess%' and lower(name) like '%pale ale%';

-- IREKS Palisander Crystal Rosewood ~20 lb
update ingredients set cost_per_unit = 0.91
where cost_per_unit is null
  and lower(name) like '%ireks%'
  and (lower(name) like '%rosewood%' or lower(name) like '%palisander%');

-- Briess Caramel Malt 20L ~25 lb
update ingredients set cost_per_unit = 1.00
where cost_per_unit is null
  and lower(name) like '%briess%' and lower(name) like '%caramel%'
  and lower(name) like '%20l%' and lower(name) not like '%120l%';

-- Flaked Corn 25 lb (Briess)
update ingredients set cost_per_unit = 1.00
where cost_per_unit is null
  and lower(name) like '%flaked%' and lower(name) like '%corn%'
  and lower(name) not like '%corn sugar%';

-- Dextrose 100 lb (Corn Sugar)
update ingredients set cost_per_unit = 0.90
where cost_per_unit is null
  and (lower(name) like '%dextrose%' or lower(name) like '%corn sugar%');

-- ── Generic fallbacks: anything else in the catalog, by variety ──────────
-- (Ordered specific -> general; first match wins because of the null guard.)

-- $0.69–0.80 base malts
update ingredients set cost_per_unit = 0.80
where cost_per_unit is null
  and (lower(name) like '%pilsner%' or lower(name) like '%pilsen%');
update ingredients set cost_per_unit = 0.80
where cost_per_unit is null and lower(name) like '%pale ale%';
update ingredients set cost_per_unit = 0.69
where cost_per_unit is null
  and (lower(name) like '%2-row%' or lower(name) like '%2 row%');
update ingredients set cost_per_unit = 0.91
where cost_per_unit is null and lower(name) like '%maris otter%';
update ingredients set cost_per_unit = 0.80
where cost_per_unit is null and lower(name) like '%vienna%'
  and lower(name) not like '%caramel%';
update ingredients set cost_per_unit = 0.80
where cost_per_unit is null and lower(name) like '%munich%'
  and lower(name) not like '%caramel%';
update ingredients set cost_per_unit = 1.00
where cost_per_unit is null and lower(name) like '%red wheat%';
update ingredients set cost_per_unit = 1.30
where cost_per_unit is null and lower(name) like '%white wheat%';
update ingredients set cost_per_unit = 0.80
where cost_per_unit is null and lower(name) like '%wheat%'
  and lower(name) not like '%flaked%';
update ingredients set cost_per_unit = 0.85
where cost_per_unit is null and lower(name) like '%rye%';
update ingredients set cost_per_unit = 1.10
where cost_per_unit is null and lower(name) like '%oat malt%';
update ingredients set cost_per_unit = 0.90
where cost_per_unit is null and lower(name) like '%mild malt%';

-- Crystal / caramel / kilned (Carafa excluded — no Weyermann pricing)
update ingredients set cost_per_unit = 1.00
where cost_per_unit is null and lower(name) like '%carapils%';
update ingredients set cost_per_unit = 1.00
where cost_per_unit is null and lower(name) like '%caramel%';
update ingredients set cost_per_unit = 0.95
where cost_per_unit is null and lower(name) like '%crystal%';
update ingredients set cost_per_unit = 0.95
where cost_per_unit is null and lower(name) like '%cara%'
  and lower(name) not like '%carafa%';
update ingredients set cost_per_unit = 1.00
where cost_per_unit is null and lower(name) like '%honey malt%';
update ingredients set cost_per_unit = 1.04
where cost_per_unit is null and lower(name) like '%victory%';
update ingredients set cost_per_unit = 1.04
where cost_per_unit is null and lower(name) like '%special roast%';
update ingredients set cost_per_unit = 0.90
where cost_per_unit is null and lower(name) like '%aromatic%';
update ingredients set cost_per_unit = 0.87
where cost_per_unit is null and lower(name) like '%melanoidin%';
update ingredients set cost_per_unit = 0.88
where cost_per_unit is null
  and (lower(name) like '%dextrin%' or lower(name) like '%kilned%'
       or lower(name) like '%steamed%');

-- Dark malts
update ingredients set cost_per_unit = 1.00
where cost_per_unit is null and lower(name) like '%chocolate%';
update ingredients set cost_per_unit = 0.95
where cost_per_unit is null
  and (lower(name) like '%black malt%' or lower(name) like '%black patent%');
update ingredients set cost_per_unit = 1.08
where cost_per_unit is null and lower(name) like '%blackprinz%';
update ingredients set cost_per_unit = 0.80
where cost_per_unit is null and lower(name) like '%midnight wheat%';
update ingredients set cost_per_unit = 0.95
where cost_per_unit is null and lower(name) like '%roasted barley%';

-- Specialty
update ingredients set cost_per_unit = 1.10
where cost_per_unit is null and lower(name) like '%smoked%';
update ingredients set cost_per_unit = 1.04
where cost_per_unit is null
  and (lower(name) like '%acidulated%' or lower(name) like '%sour malt%');
update ingredients set cost_per_unit = 0.84
where cost_per_unit is null and lower(name) like '%spitz%';

-- Adjuncts
update ingredients set cost_per_unit = 1.30
where cost_per_unit is null and lower(name) like '%flaked rice%';
update ingredients set cost_per_unit = 0.76
where cost_per_unit is null and lower(name) like '%flaked oats%';
update ingredients set cost_per_unit = 0.70
where cost_per_unit is null
  and lower(name) like '%flaked%'
  and (lower(name) like '%barley%' or lower(name) like '%wheat%'
       or lower(name) like '%rye%');
update ingredients set cost_per_unit = 1.00
where cost_per_unit is null
  and (lower(name) like '%cane sugar%' or lower(name) like '%demerara%');
update ingredients set cost_per_unit = 1.30
where cost_per_unit is null and lower(name) like '%lactose%';
update ingredients set cost_per_unit = 0.90
where cost_per_unit is null and lower(name) like '%maltodextrin%';
update ingredients set cost_per_unit = 0.44
where cost_per_unit is null and lower(name) like '%rice hulls%';

-- ── Report: what's still missing a cost ──────────────────────────────────
select count(*) filter (where cost_per_unit is null) as missing_cost,
       count(*) as total_ingredients
from ingredients;

select name, category, unit
from ingredients
where cost_per_unit is null
order by category, name;
