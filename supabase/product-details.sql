-- Highway 71 Ops — Ingredient product details (Nov 16, 2026).
-- Run once in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Pack size: how much of the ingredient's own unit one purchased pack holds
-- ("bag" = 55 lb, "box" = 44 lb, "case" = 24 each). The invoice review
-- screen uses it to turn "2 bag @ $55" into 110 lb at $1.00/lb, and posting
-- an invoice learns it automatically from the reviewed quantities.
--
-- The app works without this migration (pack sizes just aren't saved);
-- every read of these columns is optional.

alter table ingredients add column if not exists pack_size numeric;   -- e.g. 55
alter table ingredients add column if not exists pack_unit text;      -- e.g. 'lb' (the ingredient's unit)
alter table ingredients add column if not exists pack_label text;     -- e.g. 'bag', as invoiced
