# Reports design — production, COGS, sales, tax, any period

_Written Nov 5, 2026, from Andy's ask: one smart way to track beer inventory
so the app can report production, COGS on that production, sales, taxes owed,
for any date range._

**Status: BUILT Nov 5, 2026** — `/reports` page + shared period picker
(`lib/period.ts`) + shared cost basis (`lib/beer-cost.ts`, extracted from
Accounting) + `tap_events` + backdated keg movements with batch links
(`supabase/reports.sql`). `tsc` clean, `next build` passes, period math
unit-checked (month / last month / full-month custom / arbitrary range /
quarter). Live check still Andy's: run the SQL, upload the code, open
`/reports` for October and compare against the ledger.

**Nov 5, 2026 (later same day) — tax basis changed at Andy's direction:**
beer sold is now the inventory difference — beginning + produced − ending —
and that is the taxable amount, less approved destructions. Logged sales
stay on the page as the cross-check (derived − logged = destroyed ±
adjustments), with a check flagging any unexplained variance. No new SQL
for this change; the Orders build (below) is a separate commit.

## The smart part: don't build a reporting database. The ledgers already are one.

Everything the reports need is already append-only with a date on it:

- `finished_goods_transactions` — beer, package, qty, reason
  (`opening` / `packaged` / `sold` / `adjustment` / `destroyed` / `returned`),
  channel, `batch_id`, `created_at`
- `inventory_transactions` — ingredient qty × unit cost, reason, `batch_id`
- `packaging_runs` + `tank_assignments.volume_in_bbl / volume_out_bbl` — what was racked
- `batches` + `recipes` + `lib/recipe-cost.ts` — cost per beer ($/gal, $/bbl)

Because stock is never stored directly — it's always `SUM(qty_change)` — any
date can be reconstructed:

- **Opening (start of period) = SUM(qty_change) where created_at < period start**
- **Closing (end of period) = SUM(qty_change) where created_at < period end**
- **Activity in period = everything with created_at inside the period**

No snapshot table, no month-end close job, no "did someone run the rollover?"
step. The Beer page already does this for the current month (`monthStartBarrels`);
this design just generalizes it to any start/end date, per beer, in barrels.

One catch, already proven by racking: **late entries must carry their real date.**
Racking already stamps the rack date onto both the tank release and the
finished-beer transaction. Keg movements don't yet — they stamp "now." If a
keg sold Oct 31 gets logged Nov 2, it lands in the wrong tax month. So every
movement form gets the same editable date field racking already has.

## One period picker, everywhere

One shared control, in the URL so it's shareable and printable:

- `?from=2026-10-01&to=2026-10-31` (inclusive dates, America/Chicago)
- Presets: This month / Last month / Quarter / Year to date / Custom
- Same picker on Accounting, Beer, and the new Reports page. Pick a range once,
  every number on the page answers for that range. No per-section calendars.

Opening uses `< from`, activity uses `>= from AND < to + 1 day`, closing uses
`< to + 1 day`. All in barrels (1 bbl = 31 gal; half-barrel keg = 0.50 bbl).

## One Reports page, five sections, same period

New page `/reports` — not five separate reports. Every section reads the same
`from` / `to` and the same optional beer filter.

### 1. Production
Batches completed + beer packaged in the period, per beer and per batch:
gallons packaged, barrels, yield (barrels out vs. barrels of wort in, from
`tank_assignments`), loss in bbl/gal. Source: `packaged` finished-goods rows +
`packaging_runs`, joined to `batches`.

### 2. COGS of that production
Reuse the existing cost engine (`lib/recipe-cost.ts`, `beerCost()` in
Accounting) — do not rebuild it. Per beer and per batch: ingredient cost,
$/gal, $/bbl. Basis shown, as Accounting already does: completed-batch
actuals first, recipe estimate fallback, unpriced lines listed. Also show
WIP: value of beer in tanks at period start vs. end (active batches × usage
cost, estimate-marked where nothing is logged).

### 3. Sales
Volume sold in the period, per beer × channel (`on_premise` / `off_premise` /
`retail` / `distributor`), in bbl and gal, plus COGS of what was sold
(gallons sold × that beer's $/gal). Source: `sold` finished-goods rows.
**Revenue is not in this build** — the app records volume sold, not dollars
sold. Pint price × pints is an estimate, not sales. Real revenue comes with
Toast (Phase 5) or a manual sales-dollars field per movement. Don't fake it.

### 4. Inventory reconciliation (the proof step)
Per beer, in barrels — this is the table that makes the other four trustworthy:

```
Opening + Produced − Sold − Destroyed ± Adjustments/Returns = Closing
```

If it doesn't balance, something wasn't logged — the report says so instead of
silently publishing a tax number. This is also the TABC/TTB position table:
opening and closing barrels are exactly what Form 5130.9 and the TABC monthly
report ask for.

### 5. Taxes owed
**Correction to the ask:** tax is not the beginning-minus-end difference.
That difference is net change (produced − sold − destroyed…), not tax.
Tax is on **taxable removals** — beer sold / first sale in the period:

- Taxable bbl = `sold` rows in the period, by channel
- TABC: taxable bbl × $6.00
- TTB: taxable bbl × $3.50 (small-brewer rate)
- Total, per beer and overall

The reconciliation in §4 is what *proves* the taxable number: if opening +
produced − sold − destroyed doesn't equal closing, the sold figure can't be
trusted yet. Destroyed beer is only tax-exempt with TABC pre-approval — the
form needs an approval-reference field on `destroyed` rows before that volume
is excluded.

Still blocking the actual TABC Schedule exports (v2): license type BW vs. BP
+ permit number — still unknown.

## The three gaps to close first (small, no rebuild)

1. **"Tapped" is missing.** Today a keg is either in stock or `sold` — there
   is no "on tap" state, so poured volume can't be measured. Add a `tap_events`
   table (beer, package, qty, tapped_at) or a stock-neutral `tapped` reason
   excluded from `finished_stock`. Tapped ≠ sold: tapping moves a keg to the
   tap, selling empties it. Until Toast lands, poured = kegs tapped × size,
   sold = kegs logged sold, variance = poured − sold.
2. **Sold rows have no batch link.** `adjustFinishedGoods` takes no `batch_id`,
   so sales COGS is beer-average cost, never batch-specific. Add optional
   `batch_id` (pick from on-hand batches of that beer). Packaged rows already
   carry it via racking / `logPackaging`.
3. **Backdated movements.** Add the rack-date pattern (editable date → stamps
   `created_at`) to the keg movement form and voice `move_beer`, so late
   entries land in the right month.

No new cost logic, no snapshot table, no separate reporting store. The ledgers
+ a date range + the reconciliation table are the whole system.

## Build order

1. Shared period picker (`from`/`to` in URL) + reuse on Accounting/Beer.
2. Backdate field on keg movements + `batch_id` on sold rows + `tap_events`.
3. `/reports` page: the five sections above, all from the same period.
4. Later, unchanged: Toast for revenue + sold-vs-poured variance; TABC/TTB
   schedule exports once BW/BP is known.
