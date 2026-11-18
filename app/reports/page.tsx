import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Stat } from "@/components/ui";
import PeriodPicker from "@/components/PeriodPicker";
import PrintButton from "@/components/PrintButton";
import { parsePeriod } from "@/lib/period";
import { packageGallons, GALLONS_PER_BARREL } from "@/lib/packages";
import { buildBeerCost, packagedGallonsByBatch, type BatchCostRow, type RecipeRow, type UsageRow } from "@/lib/beer-cost";
import type { CatalogItem } from "@/lib/recipe-cost";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { exciseByBeer, TABC_PER_BBL, TTB_PER_BBL } from "@/lib/excise";

export const instant = false;

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const bbl = (n: number) => `${n.toFixed(2)} bbl`;
const gal = (n: number) => `${n.toFixed(1)} gal`;

type FgRow = {
  beer_name: string;
  package_type: string;
  qty_change: number;
  reason: string;
  channel: string | null;
  batch_id: string | null;
  approval_ref: string | null;
  created_at: string;
};
type TapRow = { beer_name: string; package_type: string; qty: number; tapped_at: string };
type TankRow = {
  batch_id: string;
  volume_in_bbl: number | null;
  volume_out_bbl: number | null;
  released_at: string | null;
};

const CHANNEL_LABEL: Record<string, string> = {
  on_premise: "On-premise",
  off_premise: "Off-premise",
  retail: "Retail",
  distributor: "Distributor",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; period?: string; beer?: string }>;
}) {
  const sp = await searchParams;
  const p = parsePeriod(sp);
  const beerFilter = sp.beer?.trim() || "";
  const supabase = await createClient();

  const [
    { data: fg },
    { data: taps },
    { data: batches },
    { data: tanks },
    { data: usage },
    { data: recipes },
    { data: catalog },
  ] = await Promise.all([
    // Full ledgers, paginated — a plain select stops at 1,000 rows silently.
    fetchAll((a, b) =>
      supabase
        .from("finished_goods_transactions")
        .select("beer_name,package_type,qty_change,reason,channel,batch_id,approval_ref,created_at")
        .order("created_at", { ascending: true })
        .order("id")
        .range(a, b)
    ),
    fetchAll((a, b) =>
      supabase
        .from("tap_events")
        .select("beer_name,package_type,qty,tapped_at")
        .order("tapped_at")
        .order("id")
        .range(a, b)
    ),
    supabase
      .from("batches")
      .select("id,recipe_name,recipe_id,status,batch_size_gal,batch_number"),
    supabase
      .from("tank_assignments")
      .select("batch_id,volume_in_bbl,volume_out_bbl,released_at"),
    fetchAll((a, b) =>
      supabase
        .from("inventory_transactions")
        .select("batch_id,qty_change,unit_cost,ingredients(cost_per_unit)")
        .not("batch_id", "is", null)
        .order("created_at")
        .order("id")
        .range(a, b)
    ),
    supabase.from("recipes").select("id,name,batch_size_gal,ingredients"),
    supabase.from("ingredients").select("id,name,unit,cost_per_unit"),
  ]);

  const fgRows = ((fg ?? []) as unknown as FgRow[]);
  const tapRows = ((taps ?? []) as unknown as TapRow[]);
  const batchRows = ((batches ?? []) as unknown as BatchCostRow[]).map((b) => ({
    ...b,
    batch_number: (b as unknown as { batch_number?: string | null }).batch_number ?? null,
  }));
  const tankRows = ((tanks ?? []) as unknown as TankRow[]);

  const { batchCost, batchPerGal: batchActualPerGal, recipeCostById, beerCost } = buildBeerCost(
    batchRows,
    ((usage ?? []) as unknown as UsageRow[]),
    ((recipes ?? []) as unknown as RecipeRow[]),
    ((catalog ?? []) as unknown as CatalogItem[]),
    packagedGallonsByBatch(fgRows, packageGallons)
  );

  const batchById = new Map(batchRows.map((b) => [b.id, b]));
  const tankByBatch = new Map(tankRows.map((t) => [t.batch_id, t]));

  // Per-batch $/gal: that batch's actual usage cost first, else its beer's basis.
  const batchPerGal = (batchId: string | null, beerName: string): number | null => {
    // Actual usage ÷ gallons actually packaged (planned size as fallback).
    return (batchId ? batchActualPerGal(batchId) : null) ?? beerCost(beerName).perGal;
  };

  const inPeriod = (d: string) => d >= p.startISO && d < p.endISO;
  const beforePeriod = (d: string) => d < p.startISO;
  const beforeEnd = (d: string) => d < p.endISO;
  const galOf = (pkg: string, qty: number) => qty * packageGallons(pkg);
  const bblOf = (pkg: string, qty: number) => galOf(pkg, qty) / GALLONS_PER_BARREL;

  const allBeers = [...new Set([...fgRows.map((r) => r.beer_name), ...tapRows.map((r) => r.beer_name)])].sort();
  const beers = beerFilter ? allBeers.filter((b) => b === beerFilter) : allBeers;

  // ── Per-beer ledger roll-up ──────────────────────────────────────────
  interface BeerRoll {
    openingBbl: number;
    closingBbl: number;
    producedGal: number;
    producedCost: number;
    soldGal: number;
    soldCogs: number;
    soldByChannel: Map<string, { gal: number; cogs: number }>;
    destroyedBbl: number;
    destroyedApprovedBbl: number;
    destroyedUnapprovedBbl: number;
    adjustmentBbl: number;
    returnedBbl: number;
    tappedGal: number;
  }
  const roll = new Map<string, BeerRoll>();
  const getRoll = (beer: string): BeerRoll => {
    let r = roll.get(beer);
    if (!r) {
      r = {
        openingBbl: 0,
        closingBbl: 0,
        producedGal: 0,
        producedCost: 0,
        soldGal: 0,
        soldCogs: 0,
        soldByChannel: new Map(),
        destroyedBbl: 0,
        destroyedApprovedBbl: 0,
        destroyedUnapprovedBbl: 0,
        adjustmentBbl: 0,
        returnedBbl: 0,
        tappedGal: 0,
      };
      roll.set(beer, r);
    }
    return r;
  };

  let soldNoBatch = 0;
  let packagedNoBatch = 0;
  for (const r of fgRows) {
    const b = getRoll(r.beer_name);
    const qty = Number(r.qty_change);
    if (beforePeriod(r.created_at)) b.openingBbl += bblOf(r.package_type, qty);
    if (beforeEnd(r.created_at)) b.closingBbl += bblOf(r.package_type, qty);
    if (!inPeriod(r.created_at)) continue;
    if (r.reason === "packaged") {
      const g = galOf(r.package_type, Math.max(0, qty));
      b.producedGal += g;
      b.producedCost += g * (batchPerGal(r.batch_id, r.beer_name) ?? 0);
      if (!r.batch_id) packagedNoBatch++;
    } else if (r.reason === "sold") {
      const g = galOf(r.package_type, Math.abs(qty));
      const cogs = g * (batchPerGal(r.batch_id, r.beer_name) ?? 0);
      b.soldGal += g;
      b.soldCogs += cogs;
      const ch = r.channel ?? "on_premise";
      const row = b.soldByChannel.get(ch) ?? { gal: 0, cogs: 0 };
      row.gal += g;
      row.cogs += cogs;
      b.soldByChannel.set(ch, row);
      if (!r.batch_id) soldNoBatch++;
    } else if (r.reason === "destroyed") {
      const bb = bblOf(r.package_type, Math.abs(qty));
      b.destroyedBbl += bb;
      if (r.approval_ref) b.destroyedApprovedBbl += bb;
      else b.destroyedUnapprovedBbl += bb;
    } else if (r.reason === "adjustment") {
      b.adjustmentBbl += bblOf(r.package_type, qty);
    } else if (r.reason === "returned") {
      b.returnedBbl += bblOf(r.package_type, qty);
    } else if (r.reason === "opening") {
      // An opening-balance row dated inside the period: count it as an
      // adjustment so opening + produced − sold − destroyed ± adj/ret
      // still equals closing.
      b.adjustmentBbl += bblOf(r.package_type, qty);
    }
  }
  for (const t of tapRows) {
    if (!inPeriod(t.tapped_at)) continue;
    getRoll(t.beer_name).tappedGal += galOf(t.package_type, Number(t.qty));
  }

  // ── Production by batch (packaged rows in the period) ────────────────
  interface BatchProd {
    batchId: string;
    beer: string;
    label: string;
    gal: number;
    cost: number;
    volIn: number | null;
    volOut: number | null;
  }
  const prodByBatch = new Map<string, BatchProd>();
  for (const r of fgRows) {
    if (r.reason !== "packaged" || !inPeriod(r.created_at) || !r.batch_id) continue;
    const b = batchById.get(r.batch_id);
    const g = galOf(r.package_type, Math.max(0, Number(r.qty_change)));
    const row = prodByBatch.get(r.batch_id) ?? {
      batchId: r.batch_id,
      beer: r.beer_name,
      label: b?.batch_number ? `Batch #${b.batch_number}` : r.beer_name,
      gal: 0,
      cost: 0,
      volIn: tankByBatch.get(r.batch_id)?.volume_in_bbl != null
        ? Number(tankByBatch.get(r.batch_id)!.volume_in_bbl)
        : null,
      volOut: tankByBatch.get(r.batch_id)?.volume_out_bbl != null
        ? Number(tankByBatch.get(r.batch_id)!.volume_out_bbl)
        : null,
    };
    row.gal += g;
    row.cost += g * (batchPerGal(r.batch_id, r.beer_name) ?? 0);
    prodByBatch.set(r.batch_id, row);
  }
  const batchProdRows = [...prodByBatch.values()]
    .filter((r) => !beerFilter || r.beer === beerFilter)
    .sort((a, b) => b.gal - a.gal);

  // ── Totals ───────────────────────────────────────────────────────────
  const sum = (f: (r: BeerRoll) => number) =>
    beers.reduce((n, beer) => n + f(getRoll(beer)), 0);
  const producedGal = sum((r) => r.producedGal);
  const producedCost = sum((r) => r.producedCost);
  const soldGal = sum((r) => r.soldGal);
  const soldCogs = sum((r) => r.soldCogs);
  const soldBbl = soldGal / GALLONS_PER_BARREL; // logged sold, from "sold" rows
  const closingBbl = sum((r) => r.closingBbl);
  const openingBbl = sum((r) => r.openingBbl);
  const tappedGal = sum((r) => r.tappedGal);
  const destroyedUnapprovedBbl = sum((r) => r.destroyedUnapprovedBbl);

  // ── Beer sold, the TTB/TABC way ──────────────────────────────────────
  // Beer sold = beginning inventory + produced − ending inventory.
  // That difference is the taxable amount, less approved destructions
  // (approved destroyed beer is not taxable; unapproved destruction stays
  // in the difference, so it stays taxable). Logged sold (the "sold" rows)
  // is kept as a cross-check: derived − logged = destroyed ± adjustments,
  // so any gap has an explanation on the books.
  // Shared with Accounting (lib/excise.ts) so both pages report the same tax.
  const excise = exciseByBeer(fgRows, p.startISO, p.endISO);
  const rollName = new Map([...roll.entries()].map(([k, v]) => [v, k]));
  const derivedSoldBbl = (r: BeerRoll) => excise.get(rollName.get(r)!)?.derivedSoldBbl ?? 0;
  const taxableBbl = (r: BeerRoll) => excise.get(rollName.get(r)!)?.taxableBbl ?? 0;
  const totalDerivedSoldBbl = sum(derivedSoldBbl);
  const totalTaxableBbl = sum(taxableBbl);
  const taxTabc = totalTaxableBbl * TABC_PER_BBL;
  const taxTtb = totalTaxableBbl * TTB_PER_BBL;

  // Finished value at opening / closing, at each beer's cost per gallon.
  const finishedValueAt = (which: "opening" | "closing") =>
    beers.reduce((n, beer) => {
      const r = getRoll(beer);
      const perGal = beerCost(beer).perGal ?? 0;
      const bb = which === "opening" ? r.openingBbl : r.closingBbl;
      return n + bb * GALLONS_PER_BARREL * perGal;
    }, 0);

  // WIP at period end: active batches now, actual usage or recipe estimate.
  const activeBatches = batchRows.filter((b) =>
    ["Brewing", "Fermenting", "Conditioning"].includes(b.status)
  );
  const wipRows = activeBatches.map((b) => {
    const actual = batchCost.get(b.id) ?? 0;
    if (actual > 0) return { id: b.id, name: b.recipe_name, status: b.status, value: actual, est: false };
    const rc = b.recipe_id ? recipeCostById.get(b.recipe_id) : undefined;
    return { id: b.id, name: b.recipe_name, status: b.status, value: rc && rc.total > 0 ? rc.total : 0, est: true };
  });
  const wipValue = wipRows.reduce((n, r) => n + r.value, 0);

  // ── Checks that catch logging errors ─────────────────────────────────
  const checks: string[] = [];
  for (const beer of beers) {
    const r = getRoll(beer);
    if (r.closingBbl < -0.001)
      checks.push(`${beer}: on hand is negative (${r.closingBbl.toFixed(2)} bbl) — a movement was logged twice or a count is off.`);
    if (derivedSoldBbl(r) < -0.001)
      checks.push(`${beer}: ending inventory is higher than beginning + produced — beer sold comes out negative (${derivedSoldBbl(r).toFixed(2)} bbl). Check for a missed production entry or a count error.`);
    const variance = derivedSoldBbl(r) - r.soldGal / GALLONS_PER_BARREL;
    if (Math.abs(variance) > 0.01)
      checks.push(`${beer}: beer sold from inventory (${derivedSoldBbl(r).toFixed(2)} bbl) differs from logged sales (${(r.soldGal / GALLONS_PER_BARREL).toFixed(2)} bbl) by ${variance.toFixed(2)} bbl — explained by ${r.destroyedBbl.toFixed(2)} bbl destroyed and ${(r.adjustmentBbl + r.returnedBbl).toFixed(2)} bbl adjustments/returns. If that doesn't account for it, a sale wasn't logged.`);
  }
  if (soldNoBatch > 0)
    checks.push(`${soldNoBatch} sale${soldNoBatch === 1 ? "" : "s"} in this period have no batch linked — their COGS uses the beer-average cost, not the batch cost.`);
  if (packagedNoBatch > 0)
    checks.push(`${packagedNoBatch} packaging movement${packagedNoBatch === 1 ? "" : "s"} in this period have no batch linked.`);
  if (destroyedUnapprovedBbl > 0)
    checks.push(`${destroyedUnapprovedBbl.toFixed(2)} bbl destroyed without a TABC approval reference — still taxable until the approval is on file.`);

  const hasData = fgRows.length > 0 || tapRows.length > 0;

  return (
    <div>
      <PageHeader
        eyebrow="Books"
        title="Reports"
        action={
          <div className="flex items-center gap-2">
            <PeriodPicker
              from={p.from}
              to={p.to}
              preset={p.preset}
              basePath="/reports"
              beers={allBeers}
              beer={beerFilter || undefined}
            />
            <PrintButton />
          </div>
        }
      />
      <p className="mb-5 -mt-3 text-sm text-stone-500">
        {p.label}
        {beerFilter ? ` · ${beerFilter}` : " · All beers"} — every section below
        answers for this period. Opening is the ledger before {p.from}; closing
        is the ledger before {p.to} ends.
      </p>

      {!hasData && (
        <Card title="No movements yet">
          <p className="text-sm text-stone-500">
            Nothing in the finished-beer ledger yet. Rack a tank or log a keg
            movement and the reports fill in from the ledger — no month-end
            close step needed.
          </p>
        </Card>
      )}

      {hasData && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Produced" value={`${(producedGal / GALLONS_PER_BARREL).toFixed(2)} bbl`} sub={`${producedGal.toFixed(0)} gal · ${money(producedCost)} at cost`} />
            <Stat label="Beer sold" value={`${totalDerivedSoldBbl.toFixed(2)} bbl`} sub={`beginning + produced − ending · logged sales ${soldBbl.toFixed(2)} bbl · COGS ${money(soldCogs)}`} />
            <Stat label="Est. tax owed" value={money(taxTabc + taxTtb)} sub={`TABC ${money2(taxTabc)} · TTB ${money2(taxTtb)} on ${totalTaxableBbl.toFixed(2)} taxable bbl`} />
            <Stat label="On hand — close" value={`${closingBbl.toFixed(2)} bbl`} sub={`opened at ${openingBbl.toFixed(2)} bbl · ${money(finishedValueAt("closing"))} at cost`} />
          </div>

          {checks.length > 0 && (
            <Card title="Checks — fix before filing" className="mt-4">
              <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
                {checks.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Production — by beer" className="mt-4">
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                    <th className="px-5 py-2.5 font-semibold">Beer</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Gallons</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Barrels</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Cost</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Cost / gal</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Cost / bbl</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {beers.map((beer) => {
                    const r = getRoll(beer);
                    const c = beerCost(beer);
                    return (
                      <tr key={beer} className="transition hover:bg-stone-50">
                        <td className="px-5 py-3 font-medium text-stone-900">
                          {beer}
                          {c.basis === "recipe" && (
                            <span className="ml-2 text-xs font-normal text-amber-700">recipe est.</span>
                          )}
                        </td>
                        <td className="tnum px-3 py-3 text-right text-stone-600">{r.producedGal.toFixed(1)}</td>
                        <td className="tnum px-3 py-3 text-right text-stone-600">{(r.producedGal / GALLONS_PER_BARREL).toFixed(2)}</td>
                        <td className="tnum px-3 py-3 text-right text-stone-600">{r.producedCost ? money2(r.producedCost) : "—"}</td>
                        <td className="tnum px-3 py-3 text-right text-stone-600">{c.perGal != null ? money2(c.perGal) : "—"}</td>
                        <td className="tnum px-5 py-3 text-right font-semibold text-stone-900">{c.perGal != null ? money2(c.perGal * GALLONS_PER_BARREL) : "—"}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-stone-200 font-semibold">
                    <td className="px-5 py-3 text-stone-900">Total</td>
                    <td className="tnum px-3 py-3 text-right">{producedGal.toFixed(1)}</td>
                    <td className="tnum px-3 py-3 text-right">{(producedGal / GALLONS_PER_BARREL).toFixed(2)}</td>
                    <td className="tnum px-3 py-3 text-right">{money2(producedCost)}</td>
                    <td className="px-3 py-3" />
                    <td className="px-5 py-3" />
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
              Production is beer packaged in the period (racking + packaging
              form). Cost per beer: completed-batch actuals first, recipe
              estimate fallback — the same basis as Accounting.
            </p>
          </Card>

          <Card title="Production — by batch" className="mt-4">
            {batchProdRows.length === 0 ? (
              <p className="py-1 text-sm text-stone-500">No batches packaged in this period.</p>
            ) : (
              <div className="-mx-5 -my-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                      <th className="px-5 py-2.5 font-semibold">Batch</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Gallons</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Cost</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Cost / gal</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Yield (wort in → out)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {batchProdRows.map((r) => (
                      <tr key={r.batchId} className="transition hover:bg-stone-50">
                        <td className="px-5 py-3 font-medium text-stone-900">
                          <Link href={`/batches/${r.batchId}`} className="hover:underline">
                            {r.label}
                          </Link>
                          <span className="ml-2 text-xs font-normal text-stone-400">{r.beer}</span>
                        </td>
                        <td className="tnum px-3 py-3 text-right text-stone-600">{r.gal.toFixed(1)}</td>
                        <td className="tnum px-3 py-3 text-right text-stone-600">{r.cost ? money2(r.cost) : "—"}</td>
                        <td className="tnum px-3 py-3 text-right text-stone-600">
                          {r.gal > 0 && r.cost > 0 ? money2(r.cost / r.gal) : "—"}
                        </td>
                        <td className="tnum px-5 py-3 text-right text-stone-600">
                          {r.volIn != null && r.volOut != null
                            ? `${r.volIn.toFixed(2)} → ${r.volOut.toFixed(2)} bbl (${(((r.volOut - r.volIn) / r.volIn) * 100).toFixed(1)}%)`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Sales — by beer and channel" className="mt-4">
            {soldGal === 0 ? (
              <p className="py-1 text-sm text-stone-500">No sales recorded in this period.</p>
            ) : (
              <div className="-mx-5 -my-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                      <th className="px-5 py-2.5 font-semibold">Beer</th>
                      <th className="px-3 py-2.5 font-semibold">Channel</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Gallons</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Barrels</th>
                      <th className="px-5 py-2.5 text-right font-semibold">COGS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {beers.flatMap((beer) =>
                      [...getRoll(beer).soldByChannel.entries()].map(([ch, row]) => (
                        <tr key={`${beer}-${ch}`} className="transition hover:bg-stone-50">
                          <td className="px-5 py-3 font-medium text-stone-900">{beer}</td>
                          <td className="px-3 py-3 text-stone-500">{CHANNEL_LABEL[ch] ?? ch}</td>
                          <td className="tnum px-3 py-3 text-right text-stone-600">{row.gal.toFixed(1)}</td>
                          <td className="tnum px-3 py-3 text-right text-stone-600">{(row.gal / GALLONS_PER_BARREL).toFixed(2)}</td>
                          <td className="tnum px-5 py-3 text-right font-semibold text-stone-900">{money2(row.cogs)}</td>
                        </tr>
                      ))
                    )}
                    <tr className="border-t-2 border-stone-200 font-semibold">
                      <td className="px-5 py-3 text-stone-900">Total</td>
                      <td className="px-3 py-3" />
                      <td className="tnum px-3 py-3 text-right">{soldGal.toFixed(1)}</td>
                      <td className="tnum px-3 py-3 text-right">{soldBbl.toFixed(2)}</td>
                      <td className="tnum px-5 py-3 text-right">{money2(soldCogs)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
              COGS of sold beer uses the batch cost when the sale is linked to
              a batch, otherwise the beer-average cost. Revenue isn&apos;t
              here — the app records volume sold, not dollars. Real revenue
              comes with Toast.
            </p>
          </Card>

          <Card title="Poured vs. sold" className="mt-4">
            {tappedGal === 0 ? (
              <p className="py-1 text-sm text-stone-500">
                No taps logged in this period — log a tap on the Finished Beer
                page when a keg goes on, and poured volume will show up here
                against what was sold.
              </p>
            ) : (
              <div className="-mx-5 -my-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                      <th className="px-5 py-2.5 font-semibold">Beer</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Poured (tapped)</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Sold</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {beers
                      .filter((beer) => getRoll(beer).tappedGal > 0 || getRoll(beer).soldGal > 0)
                      .map((beer) => {
                        const r = getRoll(beer);
                        const v = r.tappedGal - r.soldGal;
                        return (
                          <tr key={beer} className="transition hover:bg-stone-50">
                            <td className="px-5 py-3 font-medium text-stone-900">{beer}</td>
                            <td className="tnum px-3 py-3 text-right text-stone-600">{gal(r.tappedGal)}</td>
                            <td className="tnum px-3 py-3 text-right text-stone-600">{gal(r.soldGal)}</td>
                            <td className="tnum px-5 py-3 text-right font-semibold text-stone-900">
                              {gal(v)}
                              {r.tappedGal > 0 ? ` (${((v / r.tappedGal) * 100).toFixed(1)}%)` : ""}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
              Variance is foam, over-pours, comps, and waste — poured minus
              sold. Until Toast is connected, &ldquo;sold&rdquo; means kegs
              logged sold, not register sales.
            </p>
          </Card>

          <Card title="Inventory reconciliation — the tax position" className="mt-4">
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                    <th className="px-5 py-2.5 font-semibold">Beer</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Beginning</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Produced</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Ending</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Beer sold</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Logged sold</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Variance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {beers.map((beer) => {
                    const r = getRoll(beer);
                    const derived = derivedSoldBbl(r);
                    const logged = r.soldGal / GALLONS_PER_BARREL;
                    return (
                      <tr key={beer} className="transition hover:bg-stone-50">
                        <td className="px-5 py-3 font-medium text-stone-900">{beer}</td>
                        <td className="tnum px-3 py-3 text-right text-stone-600">{r.openingBbl.toFixed(2)}</td>
                        <td className="tnum px-3 py-3 text-right text-stone-600">{(r.producedGal / GALLONS_PER_BARREL).toFixed(2)}</td>
                        <td className="tnum px-3 py-3 text-right text-stone-600">{r.closingBbl.toFixed(2)}</td>
                        <td className="tnum px-3 py-3 text-right font-semibold text-stone-900">{derived.toFixed(2)}</td>
                        <td className="tnum px-3 py-3 text-right text-stone-600">{logged.toFixed(2)}</td>
                        <td className="tnum px-5 py-3 text-right text-stone-600">
                          {(derived - logged).toFixed(2)}
                          {r.destroyedUnapprovedBbl > 0 && (
                            <span className="ml-1 text-xs font-medium text-amber-700">no approval</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-stone-200 font-semibold">
                    <td className="px-5 py-3 text-stone-900">Total</td>
                    <td className="tnum px-3 py-3 text-right">{openingBbl.toFixed(2)}</td>
                    <td className="tnum px-3 py-3 text-right">{(producedGal / GALLONS_PER_BARREL).toFixed(2)}</td>
                    <td className="tnum px-3 py-3 text-right">{closingBbl.toFixed(2)}</td>
                    <td className="tnum px-3 py-3 text-right">{totalDerivedSoldBbl.toFixed(2)}</td>
                    <td className="tnum px-3 py-3 text-right">{soldBbl.toFixed(2)}</td>
                    <td className="tnum px-5 py-3 text-right">{(totalDerivedSoldBbl - soldBbl).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
              Beer sold = beginning + produced − ending, straight from the
              ledger — these are the opening and closing barrel counts TABC
              and TTB ask for. Logged sold is what was entered as sales; the
              variance between the two is destroyed beer ± adjustments/returns
              (see the checks above if it doesn&apos;t add up). Finished value:
              {` ${money(finishedValueAt("opening"))}`} at open,{" "}
              {`${money(finishedValueAt("closing"))}`} at close. Beer in
              process at period end: {money(wipValue)} across{" "}
              {wipRows.length} active batch{wipRows.length === 1 ? "" : "es"}.
            </p>
          </Card>

          <Card title="Taxes owed" className="mt-4">
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                    <th className="px-5 py-2.5 font-semibold">Beer</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Taxable bbl</th>
                    <th className="px-3 py-2.5 text-right font-semibold">TABC $6.00/bbl</th>
                    <th className="px-3 py-2.5 text-right font-semibold">TTB $3.50/bbl</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {beers
                    .filter((beer) => taxableBbl(getRoll(beer)) > 0)
                    .map((beer) => {
                      const r = getRoll(beer);
                      const bb = taxableBbl(r);
                      return (
                        <tr key={beer} className="transition hover:bg-stone-50">
                          <td className="px-5 py-3 font-medium text-stone-900">
                            {beer}
                            {r.destroyedApprovedBbl > 0 && (
                              <span className="ml-2 text-xs font-normal text-stone-400">
                                less {r.destroyedApprovedBbl.toFixed(2)} bbl approved destruction
                              </span>
                            )}
                          </td>
                          <td className="tnum px-3 py-3 text-right text-stone-600">{bb.toFixed(2)}</td>
                          <td className="tnum px-3 py-3 text-right text-stone-600">{money2(bb * TABC_PER_BBL)}</td>
                          <td className="tnum px-3 py-3 text-right text-stone-600">{money2(bb * TTB_PER_BBL)}</td>
                          <td className="tnum px-5 py-3 text-right font-semibold text-stone-900">{money2(bb * (TABC_PER_BBL + TTB_PER_BBL))}</td>
                        </tr>
                      );
                    })}
                  <tr className="border-t-2 border-stone-200 font-semibold">
                    <td className="px-5 py-3 text-stone-900">Total</td>
                    <td className="tnum px-3 py-3 text-right">{totalTaxableBbl.toFixed(2)}</td>
                    <td className="tnum px-3 py-3 text-right">{money2(taxTabc)}</td>
                    <td className="tnum px-3 py-3 text-right">{money2(taxTtb)}</td>
                    <td className="tnum px-5 py-3 text-right">{money2(taxTabc + taxTtb)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
              Taxable barrels = beer sold (beginning + produced − ending) less
              approved destructions. Destroyed beer counts as sold — and stays
              taxable — unless a TABC pre-approval is on file; see the checks
              above. Estimates only: file from the AIMS / TTB forms, and the
              Schedule 1/2/4 exports are still a v2 build (blocked on the
              BW-vs-BP license answer).
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
