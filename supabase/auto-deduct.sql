-- Highway 71 Ops — Auto-deduct audit report on batches.
-- Run once in the Supabase SQL Editor (after phase2-recipes.sql).
-- No policy change needed: batches policies are table-level, and the
-- sync runs as service_role. If this isn't run, auto-deduction still
-- works — only the batch-page audit card is missing (the ledger notes
-- still carry every substitution).

alter table batches add column if not exists auto_deduct_report jsonb;
-- Shape: { deducted_at: timestamptz,
--          lines: [{ recipe_ingredient, recipe_qty, recipe_unit,
--                    used_ingredient, used_qty, used_unit,
--                    substituted, shortage, skipped_reason }] }
