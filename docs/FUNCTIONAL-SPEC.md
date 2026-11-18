# Highway 71 Ops — Functional Spec v2

_Written Oct 23, 2026, from Andy's direction. Supersedes the v1 scope where they differ._
_Core rule (unchanged): Brewfather is the source of truth for recipes and batch design.
This app is the source of truth for physical inventory, kegs, costs, and tax events._

## 1. Ingredient inventory — all brewery categories

Not just grain. Industry-standard categories:

- Grain & Malt
- Adjuncts & Sugars
- Hops
- Yeast & Bacteria
- Water & Salts (gypsum, calcium chloride, Epsom, baking soda…)
- Fining & Process Aids (Whirlfloc, Irish moss, Biofine, yeast nutrient…)
- Acids (lactic, phosphoric…)
- Fruit & Flavorings (purees, extracts, spices…)
- Cleaning & Sanitation (caustic, PBW, Star San, acid rinse…)
- Gases (CO₂, N₂, beer gas)
- Packaging Materials (cans, crowlers, labels, carriers…)

Each ingredient carries: name, category, supplier, unit (lb / oz / kg / g / L / mL / each),
**cost per unit**, low-stock threshold. On-hand is always the sum of the movement ledger —
nothing is ever edited directly.

**Costs:** come from supplier invoices (see §1a). The price actually paid is recorded on
each purchase movement, and the ingredient's running weighted-average cost updates the
moment an invoice is posted — so every cost figure in the app (batch cost sheets,
inventory value, COGS) is always working from the latest real prices.

## 1a. Invoice intake — receiving & pricing

1. An invoice comes in (photo of a paper invoice, or a PDF from the supplier).
2. The app reads it: supplier, invoice #, date, and every line item — product,
   quantity, unit price, line total.
3. Each line is matched to an ingredient (the app remembers past matches, so
   "Briess Pale Ale 50#" maps to Briess Pale Ale Malt every time after the first).
   Unmatched lines can create a new ingredient on the spot.
4. **Review screen**: quantities and prices are editable; freight/tax shown
   separately. Nothing posts until a human confirms — same rule as voice commands.
5. On confirm, in one motion:
   - Inventory increases by the received quantities (purchase movements).
   - Each ingredient's cost updates from the invoice prices (weighted average).
   - The invoice total lands in the spend report under that supplier.
6. The original invoice file is stored against the record for later reference.

## 2. Brew day — Brewfather owns it (manual logging removed Oct 30, 2026)

Brew days are created in Brewfather, never in this app. The old
Log-brew-day page, dashboard button, nav link, and "Brew this recipe"
button were deleted: with auto-deduct on sync, manual batch creation
would double-count. The app represents Brewfather's batch data and
edits the logs *around* it (fermentation readings, ingredient usage,
packaging, keg movements) — it never creates batches. New Brewfather
batches deduct their recipe bill from inventory automatically on sync
(see §6).

## 3. COGS & spend reports

- **Batch cost sheet** (per batch): Σ (actual qty × cost) across all ingredients +
  packaging materials → batch COGS, and unit costs: $/gal, $/half-barrel, $/pint.
- **Monthly COGS report**: ingredient spend (purchases in), COGS of beer sold,
  inventory value on hand, cost per barrel by beer.
- **Spend tracking**: every purchase logged with dollars → monthly spend by
  category and by supplier.

## 4. Keg inventory (the core)

**Counts by beer and package size** (decided Oct 23, 2026 — no per-keg serialization):

- On-hand counts per beer × package (half-barrel, sixth-barrel, cases), as in v1.
- A **"tapped" movement** is logged whenever a keg goes on tap, so poured volume
  per beer = kegs tapped × keg size. That's what the sold-vs-poured report needs —
  it works in aggregate without tracking individual keg shells.
- Sales stay channel-tagged (taproom / to-go / retail / distributor) as in v1.

## 5. Volume: sold vs poured (Toast phase)

- **Produced**: gallons packaged per month (from packaging runs).
- **Poured**: gallons that went on tap in the period (kegs tapped × size).
- **Sold**: Toast sales mapped item → beer → pour size → gallons sold.
- **Variance report**: poured − sold = shrinkage (foam, over-pours, comps, waste),
  shown as gallons and % per beer per month — the number that tells you what the
  taps are really costing.
- The same sold-volume data feeds the planned TABC Schedule 1/4 exports (tax v2),
  so the tax report becomes a byproduct instead of a monthly chore.

## 6. Auto-deduct on Brewfather sync — the one-stop-shop rule

When sync first sees a batch in an active status (Brewing, Fermenting,
Conditioning, Completed), the batch's recipe bill deducts from Ingredient
Inventory automatically — no manual pull sheet needed for Brewfather brews.

- **Substitution:** the exact brand deducts first. If it's short or absent,
  the closest on-hand variety in the same category covers the rest
  (brand/maltster names are ignored when comparing — Weyermann Pilsner
  Malt and IREKS Pilsner Malt are the same malt). Substitutions are
  deliberately conservative: a weak match is skipped and reported, never
  silently deducted.
- **Splits:** a line can draw from several items (100 lb exact + 120 lb
  substitute). If total stock falls short, the remainder still deducts
  from the best candidate and is flagged SHORT, so usage stays truthful
  and the gap is visible instead of hidden.
- **Never retroactive:** batches already in the app with an active status
  are never auto-deducted — the Oct 19 physical counts already reflect
  them. Only batches first seen after this ships, plus Planning batches
  that later move to an active status, deduct. A batch with existing
  usage rows (manual pull sheet) is never deducted twice.
- **Audit:** every auto-deduction is a normal brew_usage ledger row with
  a note naming the substitution, plus a per-batch report
  (`batches.auto_deduct_report`, see `supabase/auto-deduct.sql`) shown
  on the batch page; recent auto-deductions show on the dashboard.
  Negative on-hand shows as SHORT on the inventory page.

## 7. Taproom margin by beer

Margin = (pint price − ingredient cost per pint) ÷ pint price.

- Cost per pint comes from completed batches of that beer (total
  ingredient cost ÷ gallons ÷ 8 pints), the same cost basis as the
  Accounting COGS numbers.
- Pint prices live in `beer_prices` (see `supabase/beer-prices.sql`) and
  are entered once per beer on the Accounting page, inline in the margin
  table. A beer shows no margin until it has both a price and completed
  batches to cost from.
- The batch cost sheet also shows the margin line for its beer when a
  pint price exists.
- Margin is on ingredient cost only — labor, rent, and overhead
  aren't in the app yet, so true net margin runs lower. That caveat is
  printed on the card, not buried.

## 8. Fermentation sheet scanning

Photo or PDF of a paper fermentation log -> vision extraction -> draft
scan -> review -> post. Each row: date, °Plato, temperature, matched to
its batch (batch-number hit first, then fuzzy beer-name match; unmatched
rows are highlighted for a manual pick in review).

cellar shorthand, e.g. "9/7 10.5 54 DH 1# Azacca" reads as September 7,
10.5° Plato, 54°F, dry-hopped with 1 lb of Azacca that day.
- Dates are month/day; gravity is always °Plato (never SG); temp is °F.
- Actions are expanded to plain English and stored in the reading's
  note — Brewfather has no dry-hop field, so the note is the record.
- °Plato is stored natively on each reading and shown on the batch's
  fermentation sheet; SG is still computed for compatibility.
- Batch matching only considers actively fermenting batches (Brewing /
  Fermenting). An explicit batch number ("Hazy 35", "Batch #34") matches
  directly; a beer name alone ("Hazy") defaults to the HIGHEST batch
  number among matches — higher number = more recent brew. Completed /
  conditioning batches never match.
- Gravity is degrees Plato everywhere in the scanned flow: the review
  table's gravity column is °P with SG as small subordinate text, and the
  batch's fermentation sheet shows "10.5 °P" with SG beneath it. SG is
  still stored for compatibility but never the headline.
- Posting converts °Plato to specific gravity and writes
  `fermentation_readings`.
- Posting is idempotent: rows already in the log (same batch + date +
  gravity) are skipped, so re-scanning a sheet is safe.
- Nothing posts until review: the scanner is draft-first like invoices.
- Draft scans can be deleted (list or review page) when the photo was
  poor or the match was wrong; deleting also removes the stored sheet
  file. Posted scans are immutable — their readings are already in the
  log.
- Voice ("log a reading for …") and the per-batch reading form remain
  as input paths alongside scanning.
- Brewfather's REST API does not accept manual fermentation readings
  (readings there come from device streams or its own UI), so the app's
  fermentation log is the system of record for scanned readings.
- **Newest reading → Brewfather (Nov 16, 2026).** Posting a scan sends the
  newest reading per tank through Brewfather's Custom Stream (the device
  path, since the REST API has none): device "Tank N", °Plato + °F, the
  reading's real date in the comment (Brewfather stamps arrival time and
  can't back-date). Only the newest reading goes, so a sheet's history
  doesn't pile up on one minute; the full log stays in the app. Brewfather
  takes one reading per device per 15 min, so pushes are logged
  (`brewfather_stream_log`, `supabase/brewfather-stream.sql`) and throttled;
  the tank page shows the last push and a "Send to Brewfather" button.
  Setup: Brewfather → Settings → Power-ups → Custom Stream, copy the logging
  URL into `BREWFATHER_STREAM_URL`, then link "Tank N" to the batch in
  Brewfather once per brew. Off (no pushes) when the variable is unset.

## 8a. Fermentation tank farm + racking

Six numbered cylindroconical fermenters (1-6), visualized on the
Fermentation page with current beer/batch, latest °P/temp, days in tank,
and barrels of wort in. Tank assignments live in the app only
(`tank_assignments`) — Brewfather has no tank concept. One current batch
per tank, one current tank per batch.

- Assign/change/empty from each tank's detail page; sheet scanner on the
  tank page locks to the tank's batch.
- Barrels of wort racked INTO the tank (`volume_in_bbl`) are entered at
  assign time or edited on the tank page.
- The tank page shows a Plato-over-time fermentation curve drawn from the
  batch's readings.
- Racking: enter barrels yielded (`volume_out_bbl`) and the rack date
  (defaults to today, editable for late entries). A beer barrel is
  31 gallons volumetric. Finished beer only exists in 15.5-gallon
  half-barrel kegs, so the barrelage is the record and racking posts
  barrels x 2 as Half-barrel kegs to finished inventory (reason
  "packaged"). Barrels must be in half-barrel increments (0.5 bbl = 1 keg).
  The rack date stamps both the tank release and the finished-beer
  transaction, so the rack lands in the correct TABC/TTB month even when
  entered later. Racking releases the tank; "Empty tank" remains for
  no-yield empties.
- Live batch stats: every batch page shows OG, current gravity, live ABV,
  and IBU. ABV is computed in the app as (OG - latest reading SG) x 131.25,
  so it climbs as fermentation progresses — no need to open Brewfather.
  OG comes from the batch (Brewfather measured OG, else recipe OG, synced
  into batches.og); IBU comes from the linked recipe. The tank detail page
  shows the same ABV + IBU for the batch in the tank.
- Two-way status sync with Brewfather: racking marks the batch Completed
  locally and pushes the completion to Brewfather via the v2 API
  (PATCH /v2/batches/:id with status + measuredFg from the last reading +
  measuredBottlingSize in liters), so the next sync reads it back instead
  of reverting it. Requires the batches.write scope on the API key. If the
  push fails, the tank page shows a retry banner (the local rack always
  stands). Fermentation readings can never be pushed — Brewfather's API
  has no readings write endpoint — so the app's fermentation log remains
  the system of record for readings.
- When Brewfather marks the tank's batch Completed/Conditioning, the tank
  shows an "empty me" prompt — emptying is always manual.

## 9. Robust accounting (COGS)

- Recipe cost engine (lib/recipe-cost.ts): prices each recipe's ingredient
  bill against the current ingredient catalog (exact name match, then token
  overlap; weight-unit conversion lb/oz/kg/g) → recipe cost, $/gal, $/bbl.
- Cost per beer: completed-batch actuals first; otherwise the recipe
  estimate. Basis is shown per beer ("Completed batches" vs "Recipe
  estimate", with unpriced ingredients listed on hover).
- Finished beer inventory is valued at cost per gallon; WIP is actual
  ingredient usage per batch, with the recipe estimate for batches that
  have nothing logged yet (marked "est.").
- Period COGS, tax estimate, purchases, and production all use the same
  per-beer cost basis. "Beer produced" counts finished-goods packaged
  transactions (covers both racking and the packaging form).

## 10. Reports (built Nov 5, 2026)

One `/reports` page, five sections, all driven by one shared period picker
(`?from=` & `?to=`, presets This month / Last month / Quarter / Year to date /
Custom — `lib/period.ts`). The same picker is on Accounting and Finished
Beer, so the numbers always agree. No snapshot table: opening is the ledger
before `from`, closing is the ledger before `to` ends, activity is everything
dated inside.

- **Production** — by beer and by batch: gallons/barrels packaged, cost,
  $/gal, $/bbl, and yield (wort in → barrels out from tank assignments).
  Cost basis is the shared `lib/beer-cost.ts` (completed-batch actuals
  first, recipe estimate fallback) — the same code Accounting uses.
- **COGS of production** — produced cost per beer/batch, plus finished
  inventory value at opening vs. closing and WIP at period end.
- **Sales** — volume sold by beer × channel with COGS of sold beer (batch
  cost when the sale is linked to a batch, otherwise the beer-average cost).
  Revenue is NOT here: the app records volume sold, not dollars. Real
  revenue comes with Toast.
- **Poured vs. sold** — `tap_events` table (`supabase/reports.sql`): logging
  a tap is stock-neutral (tapping ≠ selling). Poured = kegs tapped × size,
  variance = poured − sold.
- **Inventory reconciliation** — per beer, in barrels: opening + produced −
  sold − destroyed ± adjustments/returns = closing. These are the opening
  and closing counts TABC/TTB ask for.
- **Taxes owed** — on beer sold, where beer sold = beginning inventory +
  produced − ending inventory, per beer and total: TABC $6.00/bbl + TTB
  $3.50/bbl. Approved destructions are subtracted from the taxable
  amount; unapproved destruction stays inside the difference, so it stays
  taxable. Logged sales (the "sold" rows) are shown next to the derived
  number as a cross-check — the variance is destroyed beer ±
  adjustments/returns, and the checks box flags anything unexplained.
- **Checks** — the page flags negative on-hand, sales/packaging with no
  batch linked, and destructions without an approval reference, before
  anything is filed.
- **Movement dates** — keg movements now carry an editable date (same
  rack-date pattern: stamps `created_at`, never in the future), so late
  entries land in the right tax month. Sold rows can link a batch.
- Still v2, not built: TABC Schedule 1/2/4 + TTB 5130.9 exports (blocked
  on the BW-vs-BP license answer).

## 11. Orders — brew-plan ordering (built Nov 5, 2026)

`/orders`: pick the recipes for the next brew cycle and how many batches of
each. The app totals every ingredient needed (recipe bill × batches,
converted into catalog units with the shared `matchCatalog` /
`convertWeight` from `lib/recipe-cost.ts`), subtracts what's on hand
(`ingredient_stock`), and the shortfall is the order — quantities default
to the shortfall rounded up and are editable (round up to full bags with
the supplier before sending). Lines with no catalog match or no unit
conversion are flagged, not silently skipped. Estimated cost uses the
current average cost per unit.

- Saved orders are snapshots (`ingredient_orders` +
  `ingredient_order_lines`, `supabase/orders.sql`): later inventory moves
  never rewrite them. Status draft → sent.
- Order detail page groups lines by supplier with line totals, a
  copy-as-text button (paste straight into an email to the supplier),
  print, mark-sent, and delete-draft.
- When the delivery lands, post the supplier invoice on the Invoices page
  — stock and costs update from the real invoice prices, as before.

## 12. Costing accuracy fixes (Nov 16, 2026)

- **One unit engine** (`lib/units.ts`): weight (g/kg/oz/lb), volume
  (mL/L/tsp/tbsp/fl oz/gal), and count (pkg/each/vial/pack). Recipe
  costing, the order planner, and auto-deduct substitution all convert
  through it, so hops in grams, misc in mL, and yeast in packs now price
  instead of landing in "unpriced".
- **Invoice receiving converts to the ingredient's unit** (`lib/receiving.ts`):
  "2 bag @ $55" into a lb item is 110 lb at $1.00/lb, not 2 lb at $55/lb.
  Pack size comes from the product name ("50#", "25 kg") or the
  ingredient's saved pack size; the review shows the resulting $/unit and
  blocks posting when bag-vs-lb can't be reconciled. Posting learns the
  pack size (`supabase/product-details.sql`).
- **Recipe cost sheet** on every recipe page: per-line cost, batch total,
  $/bbl, $/half-barrel, $/gal, $/pint, priced from saved costs whether or
  not the item is in stock. Unpriced lines are listed.
- **Cost per gallon uses packaged volume**: a batch's ingredient cost is
  spread over gallons actually racked/packaged, with the planned batch size
  only as the fallback before racking. Returns to stock credit the batch.
- **Tax agrees everywhere** (`lib/excise.ts`): Accounting now uses the same
  beginning + produced − ending rule as Reports.
- **No silent truncation**: ledger reads on Reports and Accounting page
  past Supabase's 1,000-row response cap (`lib/supabase/fetch-all.ts`).
- **Brewfather auto-deduct uses the batch's own bill** (scaled/edited for
  that brew), falling back to the library recipe; a batch with neither is
  reported on the batch page instead of skipped silently. Yeast keeps
  Brewfather's unit.
- **Ingredient detail page** (`/inventory/[id]`, click any item on Inventory):
  edit name, category, supplier, unit, cost, pack size, and low-stock alert;
  see on-hand, last price paid, which recipes it prices into, and its full
  movement history. Stock is never edited here (log an adjustment). The
  unit locks once any ledger row exists, since past quantities are stored
  in it. A cost set here is the working price until the next invoice blends
  real prices in.

## Build order

1. **Phase 1** — Ingredient categories + costs, **invoice intake** (the price engine).
2. **Phase 2** — Recipes synced with full bills (grain/hops/yeast/adjuncts), pull-sheet brew day with confirmed actuals, per-batch cost sheet. ✅ Built Oct 23, 2026.
3. **Phase 3** — "Tapped" keg events + on-tap counts per beer. ✅ Built Nov 5, 2026
   (`tap_events` table + "Log a tap" form on the Finished Beer page; poured-vs-sold
   variance on Reports — revenue-grade variance still waits on Toast).
4. **Phase 4** — Monthly reports: COGS, spend, volume produced/sold. ✅ Built Nov 5, 2026
   (`/reports` — production, COGS, sales, reconciliation, taxes, any period).
5. **Phase 5** — Toast integration (needs Highway 71's Toast API access) +
   sold-vs-poured variance report.

## Decisions

1. ✅ Kegs: **counts by beer** (Oct 23, 2026). Poured volume is tracked via
   "tapped" events, not individual keg records.
3. ✅ Ingredient costs: from **supplier invoices** processed in-app (Oct 23, 2026) —
   not Brewfather, not hand-maintained list prices.
4. ✅ Invoice intake: **upload in the app** — photo of a paper invoice or a digital
   PDF (Oct 23, 2026). Built in Phase 1: AI extraction → review screen → posting
   updates inventory + weighted-average costs. Manual entry is the built-in fallback.

## Open decisions

2. Deduction on **brewer-confirmed actuals** (recommended — matches what really
   got used) vs auto-deducting planned amounts when a Brewfather batch appears.
