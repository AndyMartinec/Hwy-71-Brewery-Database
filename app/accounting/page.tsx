import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Stat } from "@/components/ui";
import BeerPriceForm from "@/components/BeerPriceForm";
import PeriodPicker from "@/components/PeriodPicker";
import { parsePeriod } from "@/lib/period";
import { packageGallons, GALLONS_PER_BARREL } from "@/lib/packages";
import { buildBeerCost, packagedGallonsByBatch, type BatchCostRow, type RecipeRow, type UsageRow } from "@/lib/beer-cost";
import type { CatalogItem } from "@/lib/recipe-cost";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { exciseByBeer, TABC_PER_BBL, TTB_PER_BBL, type FgLedgerRow } from "@/lib/excise";

export const instant = false;

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export default async function AccountingPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  // Shared period (?from/&to, ?period=last, else this month) — same picker
  // as Reports and Finished Beer, so the numbers always agree.
  const p = parsePeriod(sp);
  const start = new Date(p.startISO);
  const periodEnd = new Date(p.endISO);
  const periodLabel = p.label;

  const [
    { data: stock },
    { data: batches },
    { data: usage },
    { data: fgStock },
    { data: fgLedger },
    { data: invoices },
    { data: prices },
    { data: recipes },
    { data: catalog },
  ] = await Promise.all([
    supabase.from("ingredient_stock").select("inventory_value"),
    supabase.from("batches").select("id,recipe_name,recipe_id,status,batch_size_gal"),
    // Batch usage only, every row (paginated past the 1,000-row cap).
    fetchAll((a, b) =>
      supabase
        .from("inventory_transactions")
        .select("batch_id,qty_change,unit_cost,ingredients(cost_per_unit)")
        .not("batch_id", "is", null)
        .order("created_at")
        .order("id")
        .range(a, b)
    ),
    supabase.from("finished_stock").select("*"),
    // Whole finished-beer ledger: opening/closing for tax, packaged volume
    // per batch for cost per gallon, and the period's sales.
    fetchAll((a, b) =>
      supabase
        .from("finished_goods_transactions")
        .select("beer_name,package_type,qty_change,reason,batch_id,approval_ref,created_at")
        .order("created_at")
        .order("id")
        .range(a, b)
    ),
    supabase
      .from("invoices")
      .select("total,posted_at,invoice_date")
      .eq("status", "posted"),
    supabase.from("beer_prices").select("beer_name,pint_price"),
    supabase.from("recipes").select("id,name,batch_size_gal,ingredients"),
    supabase.from("ingredients").select("id,name,unit,cost_per_unit"),
  ]);

  type LedgerRow = FgLedgerRow & { batch_id: string | null };
  const ledger = fgLedger as unknown as LedgerRow[];
  const inPeriod = (d: string) => d >= p.startISO && d < p.endISO;
  const sold = ledger.filter((r) => r.reason === "sold" && inPeriod(r.created_at));
  const packaged = ledger.filter((r) => r.reason === "packaged" && inPeriod(r.created_at));

  // ── Shared cost basis: completed-batch actuals first, recipe fallback ──
  const { batchCost, batchPerGal, recipeCostById, beerCost } = buildBeerCost(
    ((batches ?? []) as unknown as BatchCostRow[]),
    ((usage ?? []) as unknown as UsageRow[]),
    ((recipes ?? []) as unknown as RecipeRow[]),
    ((catalog ?? []) as unknown as CatalogItem[]),
    packagedGallonsByBatch(ledger, packageGallons)
  );

  // ── Positions (right now) ──
  const ingredientValue = (stock ?? []).reduce((n, s) => n + Number(s.inventory_value ?? 0), 0);

  const activeBatches = (batches ?? []).filter((b) =>
    ["Brewing", "Fermenting", "Conditioning"].includes(b.status)
  );
  // WIP: actual usage cost; batches with nothing logged yet use the recipe estimate.
  const wipRows = activeBatches.map((b) => {
    const actual = batchCost.get(b.id) ?? 0;
    if (actual > 0) return { id: b.id, name: b.recipe_name, status: b.status, value: actual, est: false };
    const rc = b.recipe_id ? recipeCostById.get(b.recipe_id) : undefined;
    return {
      id: b.id,
      name: b.recipe_name,
      status: b.status,
      value: rc && rc.total > 0 ? rc.total : 0,
      est: true,
    };
  });
  const wipValue = wipRows.reduce((n, r) => n + r.value, 0);

  let finishedValue = 0;
  let finishedBarrels = 0;
  let unvaluedBarrels = 0;
  for (const s of fgStock ?? []) {
    const gal = Number(s.on_hand) * packageGallons(s.package_type);
    finishedBarrels += gal / GALLONS_PER_BARREL;
    const c = beerCost(s.beer_name);
    if (c.perGal) finishedValue += gal * c.perGal;
    else unvaluedBarrels += gal / GALLONS_PER_BARREL;
  }

  // ── Period activity ──
  let cogs = 0;
  let gallonsSold = 0;
  const soldByBeer = new Map<string, { gal: number; cogs: number }>();
  for (const t of sold) {
    const gal = Math.abs(Number(t.qty_change)) * packageGallons(t.package_type);
    // Batch cost when the sale is linked to a batch, else the beer average
    // (same rule as Reports).
    const rate = (t.batch_id ? batchPerGal(t.batch_id) : null) ?? beerCost(t.beer_name).perGal ?? 0;
    gallonsSold += gal;
    cogs += gal * rate;
    const row = soldByBeer.get(t.beer_name) ?? { gal: 0, cogs: 0 };
    row.gal += gal;
    row.cogs += gal * rate;
    soldByBeer.set(t.beer_name, row);
  }
  const barrelsSold = gallonsSold / GALLONS_PER_BARREL;
  // Tax on beer sold = beginning + produced − ending, less approved
  // destructions — the same rule and code as the Reports page.
  const taxableBbl = [...exciseByBeer(ledger, p.startISO, p.endISO).values()].reduce(
    (n, e) => n + e.taxableBbl,
    0
  );
  const taxTabc = taxableBbl * TABC_PER_BBL;
  const taxTtb = taxableBbl * TTB_PER_BBL;

  // ── Cost per beer table ──
  const costBeers = [...new Set([
    ...(fgStock ?? []).map((s) => s.beer_name as string),
    ...sold.map((t) => t.beer_name),
  ])].sort();
  const costRows = costBeers.map((beer) => {
    const c = beerCost(beer);
    return {
      beer,
      perGal: c.perGal,
      perBbl: c.perGal != null ? c.perGal * GALLONS_PER_BARREL : null,
      basis: c.basis,
      uncosted: c.uncosted,
    };
  });

  // ── Taproom margin by beer (ingredient cost vs pint price) ──
  const priceMap = new Map(
    (prices ?? []).map((p) => [p.beer_name, Number(p.pint_price)])
  );
  const marginBeers = [...new Set([
    ...(fgStock ?? []).map((s) => s.beer_name),
    ...priceMap.keys(),
  ])].sort();
  const marginRows = marginBeers.map((beer) => {
    const perGal = beerCost(beer as string).perGal;
    const costPerPint = perGal != null ? perGal / 8 : null;
    const price = priceMap.get(beer) ?? null;
    const marginDollars =
      price != null && costPerPint != null ? price - costPerPint : null;
    const marginPct =
      marginDollars != null && price ? (marginDollars / price) * 100 : null;
    return { beer, costPerPint, price, marginDollars, marginPct };
  });

  const purchases = (invoices ?? [])
    .filter((i) => {
      // Spend lands in the month on the invoice, not the day it was keyed in.
      const d = i.invoice_date
        ? new Date(i.invoice_date + "T12:00:00Z")
        : new Date(i.posted_at ?? 0);
      return d >= start && d < periodEnd;
    })
    .reduce((n, i) => n + Number(i.total ?? 0), 0);

  const producedGal = packaged.reduce(
    (n, r) => n + Math.max(0, Number(r.qty_change)) * packageGallons(r.package_type),
    0
  );

  return (
    <div>
      <PageHeader
        eyebrow="Books"
        title="Accounting"
        action={<PeriodPicker from={p.from} to={p.to} preset={p.preset} basePath="/accounting" />}
      />

      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
        Where the money sits — right now
      </h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Raw ingredients" value={money(ingredientValue)} sub="grain · hops · yeast · adjuncts on hand" />
        <Stat label="Beer in process" value={money(wipValue)} sub={`${activeBatches.length} active batches at cost`} />
        <Stat
          label="Finished beer"
          value={money(finishedValue)}
          sub={`${finishedBarrels.toFixed(2)} bbl on hand${unvaluedBarrels > 0 ? ` · ${unvaluedBarrels.toFixed(1)} bbl uncosted` : ""}`}
        />
      </div>

      <h2 className="mb-2 mt-7 text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
        {periodLabel}
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="COGS — beer sold" value={money(cogs)} sub={`${gallonsSold.toFixed(0)} gal · ${barrelsSold.toFixed(2)} bbl sold`} />
        <Stat label="Est. tax owed" value={money(taxTabc + taxTtb)} sub={`TABC ${money2(taxTabc)} · TTB ${money2(taxTtb)} on ${taxableBbl.toFixed(2)} taxable bbl`} />
        <Stat label="Ingredient purchases" value={money(purchases)} sub="posted supplier invoices" />
        <Stat label="Beer produced" value={`${producedGal.toFixed(0)} gal`} sub={`${(producedGal / GALLONS_PER_BARREL).toFixed(2)} bbl packaged`} />
      </div>

      <Card title="Cost per beer" className="mt-4">
        <div className="-mx-5 -my-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                <th className="px-5 py-2.5 font-semibold">Beer</th>
                <th className="px-3 py-2.5 text-right font-semibold">Cost / gal</th>
                <th className="px-3 py-2.5 text-right font-semibold">Cost / bbl</th>
                <th className="px-5 py-2.5 text-right font-semibold">Basis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {costRows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-6 text-center text-stone-500">
                    No finished beer yet — costs appear once a beer has a recipe or a completed batch.
                  </td>
                </tr>
              )}
              {costRows.map((r) => (
                <tr key={r.beer} className="transition hover:bg-stone-50">
                  <td className="px-5 py-3 font-medium text-stone-900">{r.beer}</td>
                  <td className="tnum px-3 py-3 text-right text-stone-600">
                    {r.perGal != null ? money2(r.perGal) : "—"}
                  </td>
                  <td className="tnum px-3 py-3 text-right font-semibold text-stone-900">
                    {r.perBbl != null ? money2(r.perBbl) : "—"}
                  </td>
                  <td className="px-5 py-3 text-right">
                    {r.basis === "actual" && (
                      <span className="text-xs font-medium text-green-700">Completed batches</span>
                    )}
                    {r.basis === "recipe" && (
                      <span className="text-xs font-medium text-amber-700" title={r.uncosted.length ? `Unpriced: ${r.uncosted.join(", ")}` : "Full recipe priced"}>
                        Recipe estimate{r.uncosted.length > 0 ? ` (${r.uncosted.length} unpriced)` : ""}
                      </span>
                    )}
                    {r.basis == null && <span className="text-xs text-stone-400">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
          Cost per gallon comes from completed batches when they exist; otherwise it&apos;s
          estimated by pricing the recipe&apos;s ingredient bill against current ingredient
          costs. Hover a recipe estimate to see any unpriced ingredients.
        </p>
      </Card>

      <Card title="Taproom margin by beer" className="mt-4">
        <div className="-mx-5 -my-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                <th className="px-5 py-2.5 font-semibold">Beer</th>
                <th className="px-3 py-2.5 text-right font-semibold">Cost / pint</th>
                <th className="px-3 py-2.5 text-right font-semibold">Pint price</th>
                <th className="px-3 py-2.5 text-right font-semibold">Margin / pint</th>
                <th className="px-5 py-2.5 text-right font-semibold">Margin %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {marginRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-stone-500">
                    No finished beer on hand yet. Prices set here carry over
                    once a beer is packaged.
                  </td>
                </tr>
              )}
              {marginRows.map((r) => (
                <tr key={r.beer} className="transition hover:bg-stone-50">
                  <td className="px-5 py-3 font-medium text-stone-900">{r.beer}</td>
                  <td className="tnum px-3 py-3 text-right text-stone-600">
                    {r.costPerPint != null ? money2(r.costPerPint) : "—"}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <BeerPriceForm beer={r.beer} price={r.price} />
                  </td>
                  <td className="tnum px-3 py-3 text-right font-semibold text-stone-900">
                    {r.marginDollars != null ? money2(r.marginDollars) : "—"}
                  </td>
                  <td className="tnum px-5 py-3 text-right font-semibold text-stone-900">
                    {r.marginPct != null ? `${r.marginPct.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
          Margin is on ingredient cost only — labor, rent, and other overhead
          aren&apos;t in the app yet, so true net margin runs lower. A beer
          shows no margin until it has both a pint price and a cost basis.
        </p>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title={`Beer sold — ${periodLabel}`}>
          {soldByBeer.size === 0 ? (
            <p className="py-1 text-sm text-stone-500">
              No sales recorded this period. Sales logged on the Finished Beer page (or later,
              straight from Toast) show up here as COGS.
            </p>
          ) : (
            <ul className="-my-1 divide-y divide-stone-100 text-sm">
              {[...soldByBeer.entries()].map(([beer, r]) => (
                <li key={beer} className="flex items-baseline justify-between py-2">
                  <span className="font-medium text-stone-800">{beer}</span>
                  <span className="tnum text-stone-500">
                    {r.gal.toFixed(0)} gal · <span className="font-semibold text-stone-900">{money2(r.cogs)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
            COGS uses each beer&apos;s cost per gallon — from completed batches when
            available, otherwise the recipe estimate. Tax is an estimate: TABC $6.00/bbl +
            federal $3.50/bbl on beer sold (beginning + produced − ending, less
            TABC-approved destructions) — the same calculation as Reports.
          </p>
        </Card>

        <Card title="Beer in process — by batch">
          {wipRows.length === 0 ? (
            <p className="py-1 text-sm text-stone-500">No active batches.</p>
          ) : (
            <ul className="-my-1 divide-y divide-stone-100 text-sm">
              {wipRows.map((b) => (
                <li key={b.id}>
                  <Link href={`/batches/${b.id}`} className="flex items-baseline justify-between py-2 transition hover:bg-stone-50">
                    <span className="font-medium text-stone-800">
                      {b.name}
                      <span className="ml-2 text-xs font-normal text-stone-400">
                        {b.status}{b.est ? " · est." : ""}
                      </span>
                    </span>
                    <span className="tnum font-semibold text-stone-900">
                      {money2(b.value)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
            Work-in-progress = ingredients already pulled into each batch, at
            invoice-based average costs. Batches with nothing logged yet are
            estimated from the recipe bill (est.).
          </p>
        </Card>
      </div>
    </div>
  );
}
