-- TEMPORARY: open the database to unauthenticated (anon) access while the
-- app's email login is disabled (lib/config.ts AUTH_DISABLED = true).
-- Paste into Supabase → SQL Editor → Run.
-- To lock back down later, run supabase/reenable-auth.sql.

do $$
declare t text;
begin
  foreach t in array array[
    'ingredients','batches','inventory_transactions',
    'fermentation_readings','finished_goods_transactions','packaging_runs',
    'tank_assignments','tap_events','ingredient_orders','ingredient_order_lines']
  loop
    execute format('drop policy if exists "authenticated full access" on %I', t);
    execute format('drop policy if exists "temp open access" on %I', t);
    execute format(
      'create policy "temp open access" on %I
       for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
