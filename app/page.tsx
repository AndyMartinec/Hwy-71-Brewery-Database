import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { convertUnits } from "@/lib/units";
import VoiceCommandBar from "@/components/VoiceCommandBar";
import { PageHeader, Card, Stat, StatusBadge } from "@/components/ui";
import { AlertTriangle, ArrowRight } from "lucide-react";

export const instant = false;

export default async function Dashboard() {
  const supabase = await createClient();

  const [{ data: stock }, { data: kegs }, { data: batches }, { data: autoTxns }] =
    await Promise.all([
      supabase.from("ingredient_stock").select("*").order("name"),
      supabase.from("finished_stock").select("*").order("beer_name"),
      supabase
        .from("batches")
        .select("id,recipe_name,batch_number,status,brew_date")
        .in("status", ["Brewing", "Fermenting", "Conditioning"])
        .order("updated_at", { ascending: false }),
      supabase
        .from("inventory_transactions")
        .select("qty_change,unit,note,created_at,ingredients(name),batches(recipe_name)")
        .like("note", "Auto-deduct%")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

  const lowStock = (stock ?? []).filter(
    (s) => s.low_stock_threshold != null && Number(s.on_hand) <= Number(s.low_stock_threshold)
  );
  const totalKegs = (kegs ?? []).reduce((n, k) => n + Number(k.on_hand ?? 0), 0);
  // Only items weighed in lb/oz/kg/g count toward pounds.
  const totalGrainLbs = (stock ?? [])
    .filter((s) => s.category === "grain" || s.category === "adjunct")
    .reduce((n, s) => n + Math.max(0, convertUnits(Number(s.on_hand), s.unit, "lb") ?? 0), 0);
  const ingredientValue = (stock ?? []).reduce((n, s) => n + Number(s.inventory_value ?? 0), 0);
  const activeBatches = batches ?? [];

  return (
    <div>
      <PageHeader
        eyebrow="Highway 71 Brewing"
        title="Operations"
      />

      <VoiceCommandBar />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ingredientValue > 0 ? (
          <Stat label="Ingredients on hand" value={`$${ingredientValue.toFixed(0)}`} sub="grain · hops · yeast · adjuncts" />
        ) : (
          <Stat label="Grain & adjuncts" value={`${totalGrainLbs.toFixed(0)} lb`} sub="on hand" />
        )}
        <Stat label="Finished beer" value={String(totalKegs)} sub="packages on hand" />
        <Stat label="Active batches" value={String(activeBatches.length)} sub="brewing · fermenting · conditioning" />
        <Stat
          label="Low stock"
          value={String(lowStock.length)}
          sub={lowStock.length ? "items at or below threshold" : "nothing below threshold"}
        />
      </div>

      {lowStock.length > 0 && (
        <div className="mt-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          <div>
            <p className="text-sm font-semibold text-red-900">Reorder soon</p>
            <ul className="mt-1 space-y-0.5 text-sm text-red-800">
              {lowStock.map((s) => (
                <li key={s.id}>
                  {s.name} — <span className="tnum font-medium">{Number(s.on_hand).toFixed(0)} {s.unit}</span> remaining
                </li>
              ))}
            </ul>
            <Link href="/inventory" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-red-900 underline underline-offset-2">
              Open inventory <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}

      {autoTxns && autoTxns.length > 0 && (
        <div className="mt-4">
          <Card title="Auto-deducted from Brewfather">
            <ul className="-my-1 divide-y divide-stone-100 text-sm">
              {autoTxns.map((t, i) => {
                const ing = t.ingredients as unknown as { name: string } | null;
                const bat = t.batches as unknown as { recipe_name: string } | null;
                const sub = (t.note ?? "").includes("in place of");
                const short = (t.note ?? "").includes("SHORT");
                return (
                  <li key={i} className="flex items-baseline justify-between gap-3 py-1.5">
                    <span className="text-stone-700">
                      {ing?.name ?? "Ingredient"}
                      <span className="text-stone-400"> → {bat?.recipe_name ?? "batch"}</span>
                      {sub && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                          substitute
                        </span>
                      )}
                      {short && (
                        <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
                          short
                        </span>
                      )}
                    </span>
                    <span className="tnum shrink-0 font-semibold text-stone-900">
                      {Math.abs(Number(t.qty_change)) % 1 === 0
                        ? Math.abs(Number(t.qty_change)).toFixed(0)
                        : Math.abs(Number(t.qty_change)).toFixed(2)}{" "}
                      {t.unit}
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <Card
          title="Active batches"
          className="lg:col-span-3"
          action={
            <Link href="/batches" className="inline-flex items-center gap-1 text-xs font-semibold text-copper-700 hover:underline">
              All batches <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          {activeBatches.length === 0 ? (
            <p className="py-2 text-sm text-stone-500">
              No active batches. They appear here from Brewfather sync — or log a brew day.
            </p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {activeBatches.map((b) => (
                <li key={b.id}>
                  <Link href={`/batches/${b.id}`} className="flex items-center justify-between gap-3 py-2.5 transition hover:bg-stone-50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-stone-900">
                        {b.recipe_name}
                        {b.batch_number ? <span className="text-stone-400"> #{b.batch_number}</span> : null}
                      </span>
                      {b.brew_date && <span className="block text-xs text-stone-500">Brewed {b.brew_date}</span>}
                    </span>
                    <StatusBadge status={b.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Finished beer"
          className="lg:col-span-2"
          action={
            <Link href="/beer" className="inline-flex items-center gap-1 text-xs font-semibold text-copper-700 hover:underline">
              All beer <ArrowRight className="h-3 w-3" />
            </Link>
          }
        >
          {(kegs ?? []).length === 0 ? (
            <p className="py-2 text-sm text-stone-500">No packaged beer on hand.</p>
          ) : (
            <ul className="divide-y divide-stone-100">
              {(kegs ?? []).map((k) => (
                <li key={`${k.beer_name}-${k.package_type}`} className="flex items-center justify-between py-2">
                  <span className="text-sm font-medium text-stone-800">{k.beer_name}</span>
                  <span className="tnum text-sm text-stone-500">
                    <span className="font-semibold text-stone-900">{Number(k.on_hand)}</span> × {k.package_type.replace(" keg", "")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
