import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusChanger, ReadingForm, IngredientUseForm, PackagingForm } from "@/components/BatchForms";
import { CATEGORIES } from "@/lib/categories";
import { Card, StatusBadge } from "@/components/ui";
import { ArrowLeft } from "lucide-react";
import { liveAbv } from "@/lib/abv";
import { packageGallons, GALLONS_PER_BARREL } from "@/lib/packages";

export const instant = false;

export default async function BatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: batch }, { data: readings }, { data: grainUse }, { data: runs }, { data: ingredients }, { data: packagedRows }] =
    await Promise.all([
      supabase.from("batches").select("*").eq("id", id).single(),
      supabase.from("fermentation_readings").select("*").eq("batch_id", id).order("taken_at", { ascending: false }),
      supabase
        .from("inventory_transactions")
        .select("qty_change,unit_cost,note,created_at,ingredients(name,category,unit,cost_per_unit)")
        .eq("batch_id", id)
        .order("created_at", { ascending: false }),
      supabase.from("packaging_runs").select("*").eq("batch_id", id).order("packaged_at", { ascending: false }),
      supabase.from("ingredients").select("id,name,category,unit").order("name"),
      supabase
        .from("finished_goods_transactions")
        .select("package_type,qty_change")
        .eq("batch_id", id)
        .eq("reason", "packaged"),
    ]);

  if (!batch) notFound();

  // Linked recipe stats (IBU + OG/ABV fallback) for the live batch header.
  const { data: recipe } = batch.recipe_id
    ? await supabase
        .from("recipes")
        .select("og,fg,abv,ibu")
        .eq("id", batch.recipe_id)
        .maybeSingle()
    : { data: null };

  // Taproom pint price for this beer, if one has been set (table may not
  // exist yet if the beer-prices migration hasn't run — then no margin).
  const { data: priceRow } = await supabase
    .from("beer_prices")
    .select("pint_price")
    .eq("beer_name", batch.recipe_name)
    .maybeSingle();
  const pintPrice = priceRow ? Number(priceRow.pint_price) : null;

  type UsageRow = {
    name: string;
    category: string;
    unit: string;
    qty: number;
    cost: number | null;
  };
  const usage: UsageRow[] = (grainUse ?? []).map((t) => {
    const ing = t.ingredients as unknown as {
      name: string;
      category: string;
      unit: string;
      cost_per_unit: number | null;
    } | null;
    // Usage is negative; a positive row is stock returned and credits the batch.
    const qty = -Number(t.qty_change);
    const perUnit = t.unit_cost != null ? Number(t.unit_cost) : ing?.cost_per_unit;
    return {
      name: ing?.name ?? "—",
      category: ing?.category ?? "other",
      unit: ing?.unit ?? "lb",
      qty,
      cost: perUnit != null ? qty * Number(perUnit) : null,
    };
  });
  const usageByCategory = new Map<string, UsageRow[]>();
  for (const u of usage) {
    if (!usageByCategory.has(u.category)) usageByCategory.set(u.category, []);
    usageByCategory.get(u.category)!.push(u);
  }
  const CATEGORY_ORDER = ["grain", "hops", "yeast", "adjunct", "water", "fining", "acid", "fruit", "cleaning", "gas", "packaging", "other"];
  const sortedCategories = [...usageByCategory.keys()].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b)
  );
  const totalCost = usage.reduce((n, u) => n + (u.cost ?? 0), 0);
  const uncosted = usage.filter((u) => u.cost == null).length;
  const og = batch.og != null ? Number(batch.og) : recipe?.og != null ? Number(recipe.og) : null;
  const latestSg = (readings ?? []).find((r) => r.gravity != null)?.gravity ?? null;
  const abvLive = liveAbv(og, latestSg != null ? Number(latestSg) : null);
  const abvEst = abvLive == null && recipe?.abv != null ? Number(recipe.abv) : null;
  const ibu = recipe?.ibu != null ? Math.round(Number(recipe.ibu)) : null;
  // Spread cost over what was actually packaged; planned size until racked.
  const packagedGal = (packagedRows ?? []).reduce(
    (n, r) => n + Number(r.qty_change) * packageGallons(r.package_type),
    0
  );
  const gallons =
    packagedGal > 0 ? packagedGal : batch.batch_size_gal ? Number(batch.batch_size_gal) : null;
  const gallonsBasis = packagedGal > 0 ? "packaged" : "planned";
  const costPerPint = gallons && totalCost > 0 ? totalCost / (gallons * 8) : null;
  const marginDollars = pintPrice != null && costPerPint != null ? pintPrice - costPerPint : null;
  const marginPct = marginDollars != null && pintPrice ? (marginDollars / pintPrice) * 100 : null;

  return (
    <div>
      <Link href="/batches" className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 transition hover:text-copper-700">
        <ArrowLeft className="h-4 w-4" /> All batches
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-copper-700">
            Batch{batch.batch_number ? ` #${batch.batch_number}` : ""}
          </p>
          <h1 className="font-display text-4xl font-semibold uppercase tracking-wide text-ink-900">
            {batch.recipe_name}
          </h1>
          <p className="mt-1 text-sm text-stone-500">
            {[batch.brew_date && `Brewed ${batch.brew_date}`, batch.batch_size_gal && `${batch.batch_size_gal} gal`, batch.brewer]
              .filter(Boolean)
              .join(" · ") || "No details recorded"}
            {batch.brewfather_id ? " · Synced from Brewfather" : ""}
          </p>
          {batch.notes && <p className="mt-2 max-w-xl text-sm text-stone-600">{batch.notes}</p>}
        </div>
        <StatusBadge status={batch.status} />
      </div>

      <div className="mt-4">
        <StatusChanger batchId={batch.id} current={batch.status} />
      </div>

      <div className="tnum mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">OG</div>
          <div className="mt-0.5 text-xl font-semibold text-stone-900">
            {og != null ? og.toFixed(3) : "—"}
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">Gravity now</div>
          <div className="mt-0.5 text-xl font-semibold text-stone-900">
            {latestSg != null ? Number(latestSg).toFixed(3) : "—"}
          </div>
        </div>
        <div className="rounded-xl border border-copper-300 bg-copper-50 px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-copper-700">ABV</div>
          <div className="mt-0.5 text-xl font-semibold text-copper-900">
            {abvLive != null ? `${abvLive.toFixed(1)}%` : abvEst != null ? `${abvEst.toFixed(1)}%` : "—"}
          </div>
          <div className="text-[11px] text-stone-500">
            {abvLive != null ? "live from readings" : abvEst != null ? "recipe estimate" : "needs OG + a reading"}
          </div>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-3">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">IBU</div>
          <div className="mt-0.5 text-xl font-semibold text-stone-900">
            {ibu != null ? ibu : "—"}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card title="Fermentation sheet">
            {(readings ?? []).length === 0 ? (
              <p className="py-1 text-sm text-stone-500">No readings yet.</p>
            ) : (
              <div className="-mx-5 -my-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                      <th className="px-5 py-2.5 font-semibold">Date</th>
                      <th className="px-3 py-2.5 font-semibold">Gravity</th>
                      <th className="px-3 py-2.5 font-semibold">Temp</th>
                      <th className="px-5 py-2.5 font-semibold">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {readings!.map((r) => (
                      <tr key={r.id} className="transition hover:bg-stone-50">
                        <td className="whitespace-nowrap px-5 py-2.5 text-stone-600">
                          {new Date(r.taken_at).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        </td>
                        <td className="tnum px-3 py-2.5">
                          {r.plato != null ? (
                            <>
                              <span className="font-medium">{Number(r.plato).toFixed(1)} °P</span>
                              <div className="text-[11px] font-normal text-stone-400">
                                {r.gravity != null ? Number(r.gravity).toFixed(3) : ""}
                              </div>
                            </>
                          ) : (
                            <span className="font-medium">{r.gravity ?? "—"}</span>
                          )}
                        </td>
                        <td className="tnum px-3 py-2.5">{r.temp_f ? `${r.temp_f}°F` : "—"}</td>
                        <td className="px-5 py-2.5 text-stone-600">{r.note ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {(() => {
            const report = batch.auto_deduct_report as {
              deducted_at?: string;
              lines?: {
                recipe_ingredient: string;
                recipe_qty: number | null;
                recipe_unit: string;
                used_ingredient: string | null;
                used_qty: number | null;
                used_unit: string | null;
                substituted: boolean;
                shortage: boolean;
                skipped_reason: string | null;
              }[];
            } | null;
            if (!report?.lines?.length) return null;
            return (
              <Card title="Inventory auto-deducted from Brewfather">
                <p className="mb-2 text-xs text-stone-400">
                  Deducted automatically when this batch first synced as brewed
                  {report.deducted_at
                    ? ` · ${new Date(report.deducted_at).toLocaleDateString([], { month: "short", day: "numeric" })}`
                    : ""}
                  . Substitutions picked the closest on-hand variety; skipped
                  lines were never deducted — adjust them by hand if needed.
                </p>
                <ul className="-my-1 divide-y divide-stone-100 text-sm">
                  {report.lines.map((l, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 py-1.5">
                      <span className="text-stone-700">
                        {l.skipped_reason ? (
                          <>
                            {l.recipe_ingredient}
                            <span className="ml-2 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-semibold text-stone-500">
                              not deducted
                            </span>
                          </>
                        ) : (
                          <>
                            {l.used_ingredient}
                            {l.substituted && (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                sub for {l.recipe_ingredient}
                              </span>
                            )}
                            {l.shortage && (
                              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
                                short
                              </span>
                            )}
                          </>
                        )}
                      </span>
                      <span className="tnum shrink-0 text-stone-500">
                        {l.skipped_reason ? (
                          l.skipped_reason
                        ) : (
                          <span className="font-semibold text-stone-900">
                            {l.used_qty != null
                              ? `${l.used_qty % 1 === 0 ? l.used_qty.toFixed(0) : l.used_qty.toFixed(2)} ${l.used_unit}`
                              : ""}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })()}

          {usage.length > 0 && (
            <Card title="Ingredients used — by category">
              <div className="-my-1 space-y-4">
                {sortedCategories.map((cat) => {
                  const rows = usageByCategory.get(cat)!;
                  const subtotal = rows.reduce((n, u) => n + (u.cost ?? 0), 0);
                  return (
                    <div key={cat}>
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-copper-700">
                          {CATEGORIES[cat] ?? cat}
                        </h3>
                        {subtotal > 0 && (
                          <span className="tnum text-xs font-semibold text-stone-700">${subtotal.toFixed(2)}</span>
                        )}
                      </div>
                      <ul className="mt-1 divide-y divide-stone-100 text-sm">
                        {rows.map((u, i) => (
                          <li key={i} className="flex items-baseline justify-between gap-3 py-1.5">
                            <span className="text-stone-700">{u.name}</span>
                            <span className="tnum shrink-0 text-stone-500">
                              <span className="font-semibold text-stone-900">
                                {u.qty % 1 === 0 ? u.qty.toFixed(0) : u.qty.toFixed(2)} {u.unit}
                              </span>
                              {u.cost != null && <span className="ml-2">${u.cost.toFixed(2)}</span>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {usage.length > 0 && (
            <Card title="Batch cost sheet">
              <div className="-my-1">
                <div className="flex items-baseline justify-between py-1">
                  <span className="text-sm text-stone-600">Total ingredient cost</span>
                  <span className="tnum font-display text-3xl font-semibold text-ink-900">
                    ${totalCost.toFixed(2)}
                  </span>
                </div>
                {gallons ? (
                  <div className="tnum mt-1 grid grid-cols-3 gap-2 border-t border-stone-100 pt-3 text-center">
                    <div>
                      <p className="font-display text-xl font-semibold text-stone-900">${(totalCost / gallons).toFixed(2)}</p>
                      <p className="text-[11px] uppercase tracking-wider text-stone-400">per gallon</p>
                    </div>
                    <div>
                      <p className="font-display text-xl font-semibold text-stone-900">${((totalCost / gallons) * 15.5).toFixed(2)}</p>
                      <p className="text-[11px] uppercase tracking-wider text-stone-400">per half-barrel</p>
                    </div>
                    <div>
                      <p className="font-display text-xl font-semibold text-stone-900">${(totalCost / (gallons * 8)).toFixed(2)}</p>
                      <p className="text-[11px] uppercase tracking-wider text-stone-400">per pint</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-stone-400">Add a batch size to see cost per gallon / keg / pint.</p>
                )}
                {gallons != null && (
                  <p className="tnum mt-2 text-center text-[11px] text-stone-400">
                    {gallonsBasis === "packaged"
                      ? `Spread over ${gallons.toFixed(1)} gal actually packaged (${(gallons / GALLONS_PER_BARREL).toFixed(2)} bbl).`
                      : `Spread over the planned ${gallons.toFixed(1)} gal batch size — updates to packaged volume once racked.`}
                  </p>
                )}
                {marginDollars != null && marginPct != null && (
                  <p className="tnum mt-3 border-t border-stone-100 pt-3 text-sm text-stone-600">
                    At <span className="font-semibold text-stone-900">${pintPrice!.toFixed(2)}/pint</span> taproom
                    price:{" "}
                    <span className="font-semibold text-stone-900">
                      ${marginDollars.toFixed(2)} margin per pint ({marginPct.toFixed(1)}%)
                    </span>
                    <span className="text-stone-400"> — ingredient cost only</span>
                  </p>
                )}
                {uncosted > 0 && (
                  <p className="mt-2 text-xs text-stone-400">
                    {uncosted} ingredient{uncosted > 1 ? "s have" : " has"} no cost yet — costs arrive with supplier invoices, so this total is partial.
                  </p>
                )}
              </div>
            </Card>
          )}

          {(runs ?? []).length > 0 && (
            <Card title="Packaging runs">
              <ul className="-my-1 divide-y divide-stone-100 text-sm">
                {runs!.map((r) => (
                  <li key={r.id} className="flex justify-between py-2">
                    <span className="text-stone-700">
                      <span className="tnum font-semibold text-stone-900">{r.qty}</span> × {r.package_type}
                      {r.gallons ? ` · ${r.gallons} gal` : ""}
                    </span>
                    <span className="text-stone-500">{new Date(r.packaged_at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <ReadingForm batchId={batch.id} />
          <IngredientUseForm batchId={batch.id} ingredients={ingredients ?? []} />
          <PackagingForm batchId={batch.id} defaultBeer={batch.recipe_name} />
        </div>
      </div>
    </div>
  );
}
