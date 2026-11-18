import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SyncButton from "@/components/SyncButton";
import { PageHeader, Card } from "@/components/ui";
import { ArrowRight } from "lucide-react";
import type { RecipeIngredient } from "@/lib/sync";

export const instant = false;

export default async function RecipesPage() {
  const supabase = await createClient();
  const { data: recipes } = await supabase
    .from("recipes")
    .select("id,name,style,batch_size_gal,og,abv,ibu,ingredients")
    .order("name");

  return (
    <div>
      <PageHeader eyebrow="Production" title="Recipes" action={<SyncButton />} />

      {(recipes ?? []).length === 0 ? (
        <Card>
          <p className="py-2 text-sm text-stone-500">
            No recipes synced yet. Hit <strong>Sync from Brewfather</strong> and every recipe
            arrives with its full ingredient bill — grain, hops, yeast, and adjuncts.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(recipes ?? []).map((r) => {
            const ings = (r.ingredients ?? []) as RecipeIngredient[];
            const counts = {
              grain: ings.filter((i) => i.category === "grain").length,
              hops: ings.filter((i) => i.category === "hops").length,
              yeast: ings.filter((i) => i.category === "yeast").length,
              adjunct: ings.filter((i) => i.category === "adjunct").length,
            };
            return (
              <Link key={r.id} href={`/recipes/${r.id}`} className="group">
                <Card className="h-full transition group-hover:border-copper-300">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-2xl font-semibold uppercase tracking-wide text-ink-900">
                        {r.name}
                      </h3>
                      <p className="text-sm text-stone-500">
                        {[r.style, r.batch_size_gal ? `${r.batch_size_gal} gal` : null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </div>
                    <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-stone-300 transition group-hover:text-copper-600" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-medium">
                    <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600">{counts.grain} grain</span>
                    <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600">{counts.hops} hops</span>
                    <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600">{counts.yeast} yeast</span>
                    <span className="rounded-full bg-stone-100 px-2.5 py-1 text-stone-600">{counts.adjunct} adjuncts</span>
                  </div>
                  {(r.og || r.abv || r.ibu) && (
                    <p className="tnum mt-3 text-xs text-stone-400">
                      {[r.og ? `OG ${r.og}` : null, r.abv ? `${r.abv}% ABV` : null, r.ibu ? `${r.ibu} IBU` : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
