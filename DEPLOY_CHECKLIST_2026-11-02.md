# Nov 2 deploy — your steps

Everything from today's build session in one place, in order. One session, one upload.

## 1. SQL files — Supabase → SQL Editor → paste → Run

All idempotent: re-running one you already ran is harmless. Skip ones you've done.

1. `supabase/tanks.sql` — skip if you ran it earlier today
2. `supabase/tank-volumes.sql` — must be the **fixed version from the latest zip** (your first attempt errored halfway; the fix drops and rebuilds the `finished_stock` view). Re-running picks up where it left off.
3. `supabase/ingredient-costs-seed.sql` — placeholder costs from the Pro Brew Supply Jan 2025 sheet; fills blanks only, never overwrites invoice costs
4. `supabase/batch-og.sql` — run **before** you hit Sync in the app (this ordering caused the sync error)
5. `supabase/beer-prices.sql` — still needed for the taproom margin card (Oct 26)
6. `supabase/auto-deduct.sql` — skip if you ran it Oct 26

## 2. Upload the code

Upload the **extracted code folder** to GitHub — never the zip file. Vercel auto-deploys from the push. **Never manually Promote an older deployment** — it rolls the site back (the Oct 30 "why does this keep changing").

## 3. Brewfather key scope

Brewfather → Settings → API → your key needs the **`batches.write`** scope (it was created read-only). Without it, racking still completes locally but the Completed push to Brewfather fails — the tank page shows a retry banner when that happens.

## 4. Taproom prices

Accounting → enter each beer's taproom pint price (powers the margin card).

## Notes — not steps

- Yeast shows unpriced in recipe estimates until a yeast invoice comes in (the price sheet didn't cover it).
- Auto-deduct stays provisional until your first real batch audit matches a physical count; the manual pull sheet stays available.
- Emptying a tank without racking (a dump) does **not** push to Brewfather — your call on that one is still open.
- Fermentation readings stay in the app only — Brewfather's API has no readings endpoint. The racking push sends status + final gravity + kegged volume instead.
- Parked, your call: migrate reads from Brewfather API v1 (deprecated, no sunset date) to v2 — code-only, no new SQL, not urgent.


## Nov 16, 2026

Run `supabase/product-details.sql` (adds ingredient pack sizes). Optional: the app
works without it, but pack sizes won't be remembered between invoices.

Fermentation readings to Brewfather (optional):
1. Run `supabase/brewfather-stream.sql`.
2. In Brewfather: Settings → Power-ups → enable Custom Stream, copy the logging URL.
3. In Vercel: add env var `BREWFATHER_STREAM_URL` = that URL, then redeploy.
4. Post a scan (or press "Send to Brewfather" on a tank page). Devices "Tank 1"–"Tank 6"
   appear in Brewfather; link each to its batch (batch → Fermentation → device).
