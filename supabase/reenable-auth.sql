-- Re-enable login-only access (undo temp-open-access.sql).
-- Also set AUTH_DISABLED = false in lib/config.ts and redeploy.
-- Paste into Supabase → SQL Editor → Run.

do $$
declare t text;
begin
  foreach t in array array[
    'ingredients','batches','inventory_transactions',
    'fermentation_readings','finished_goods_transactions','packaging_runs']
  loop
    execute format('drop policy if exists "temp open access" on %I', t);
    execute format('drop policy if exists "authenticated full access" on %I', t);
    execute format(
      'create policy "authenticated full access" on %I
       for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
