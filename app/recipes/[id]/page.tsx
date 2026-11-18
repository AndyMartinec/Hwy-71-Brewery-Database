import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import { ArrowLeft } from "lucide-react";
import type { RecipeIngredient } from "@/lib/sync";
import { costRecipe, type CatalogItem } from "@/lib/recipe-cost";
import { formatUnitCost } from "@/lib/units";
import { GALLONS_PER_BARREL } from "@/lib/packages";

export const instant = false;

const GROUPS: { key: RecipeIngredient["category"]; label: string }[] = [
  { key: "grain", label: "Grain & Malt" },
  { key: "hops", label: "Hops" },
  { key: "yeast", label: "Yeast" },
  { key: "adjunct", label: "Adjuncts & Misc" },
];

export default async function RecipeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: recipe }, { data: catalog }] = await Promise.all([
    supabase.from("recipes").select("*").eq("id", id).single(),
    // Every saved ingredient with a price, in stock or not, so a recipe
    // can be costed before anything is ordered.
    supabase.from("ingredients").select("id,name,unit,cost_per_unit"),
  ]);
  if (!recipe) notFound();

  const ings = (recipe.ingredients ?? []) as RecipeIngredient[];
  const cost = costRecipe(
    ings,
    ((catalog ?? []) as CatalogItem[]).map((c) => ({
      ...c,
      cost_per_unit: c.cost_per_unit != null ? Number(c.cost_per_unit) : null,
    })),
    recipe.batch_size_gal != null ? Number(recipe.batch_size_gal) : null
  );
  // costRecipe returns lines in the same order as the bill.
  const lineCost = new Map(ings.map((ing, i) => [ing, cost.lines[i]]));
  const grainLbs = ings
    .filter((i) => i.category === "grain")
    .reduce((n, i) => n + (i.amount ?? 0), 0);

  return (
    <div>
      <Link href="/recipes" className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 transition hover:text-copper-700">
        <ArrowLeft className="h-4 w-4" /> All recipes
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-copper-700">
            Recipe{recipe.style ? ` — ${recipe.style}` : ""}
          </p>
          <h1 className="font-display text-4xl font-semibold uppercase tracking-wide text-ink-900">
            {recipe.name}
          </h1>
          <p className="tnum mt-1 text-sm text-stone-500">
            {[
              recipe.batch_size_gal ? `${recipe.batch_size_gal} gal batch` : null,
              recipe.og ? `OG ${recipe.og}` : null,
              recipe.fg ? `FG ${recipe.fg}` : null,
              recipe.abv ? `${recipe.abv}% ABV` : null,
              recipe.ibu ? `${recipe.ibu} IBU` : null,
              grainLbs ? `${grainLbs.toFixed(1)} lb grain bill` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
</div>

      {ings.length > 0 && (
        <Card title="Recipe cost — at current ingredient prices" className="mt-5">
          <div className="tnum -my-1 grid grid-cols-2 gap-3 text-center sm:grid-cols-5">
            {[
              ["Batch", `$${cost.total.toFixed(2)}`],
              ["Per barrel", cost.costPerBbl != null ? `$${cost.costPerBbl.toFixed(2)}` : "—"],
              ["Per half-barrel", cost.costPerGal != null ? `$${(cost.costPerGal * 15.5).toFixed(2)}` : "—"],
              ["Per gallon", cost.costPerGal != null ? `$${cost.costPerGal.toFixed(2)}` : "—"],
              ["Per pint", cost.costPerGal != null ? `$${(cost.costPerGal / 8).toFixed(2)}` : "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="font-display text-2xl font-semibold text-ink-900">{value}</p>
                <p className="text-[11px] uppercase tracking-wider text-stone-400">{label}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-500">
            Priced from each ingredient&apos;s saved average cost (from posted invoices), whether or
            not it&apos;s in stock{cost.batchSizeGal ? `, over the ${cost.batchSizeGal} gal recipe batch size (${(cost.batchSizeGal / GALLONS_PER_BARREL).toFixed(2)} bbl)` : ""}.
            {cost.uncosted.length > 0 && (
              <span className="mt-1 block text-amber-700">
                {cost.uncosted.length} line{cost.uncosted.length === 1 ? "" : "s"} not priced, so the total
                runs low until they are: {cost.uncosted.join(", ")}. Add the ingredient with a cost on
                the Inventory page (stock can be zero), or post an invoice for it.
              </span>
            )}
          </p>
        </Card>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {GROUPS.map(({ key, label }) => {
          const rows = ings.filter((i) => i.category === key);
          if (rows.length === 0) return null;
          return (
            <Card key={key} title={label}>
              <div className="-mx-5 -my-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-stone-100">
                    {rows.map((ing, i) => (
                      <tr key={i} className="transition hover:bg-stone-50">
                        <td className="px-5 py-2.5">
                          <span className="font-medium text-stone-900">{ing.name}</span>
                          {ing.note && <span className="block text-xs text-stone-500">{ing.note}</span>}
                        </td>
                        <td className="tnum px-3 py-2.5 text-right font-semibold text-stone-900">
                          {ing.amount != null ? ing.amount : "—"}{" "}
                          <span className="text-xs font-normal text-stone-400">{ing.unit}</span>
                        </td>
                        <td className="tnum px-5 py-2.5 text-right">
                          {(() => {
                            const lc = lineCost.get(ing);
                            if (lc?.lineCost == null)
                              return <span className="text-xs text-amber-700">no price</span>;
                            return (
                              <>
                                <span className="font-semibold text-stone-900">${lc.lineCost.toFixed(2)}</span>
                                <span className="block text-[11px] text-stone-400">
                                  {formatUnitCost(lc.unitCost!)}/{lc.catalogUnit}
                                </span>
                              </>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
        {ings.length === 0 && (
          <Card>
            <p className="py-2 text-sm text-stone-500">
              No ingredient bill synced for this recipe yet — re-run the Brewfather sync.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
