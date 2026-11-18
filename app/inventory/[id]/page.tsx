import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui";
import IngredientEditForm from "@/components/IngredientEditForm";
import { CATEGORIES } from "@/lib/categories";
import { formatUnitCost, convertUnits } from "@/lib/units";
import { matchCatalog, type CatalogItem, type RecipeLine } from "@/lib/recipe-cost";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { ArrowLeft } from "lucide-react";

export const instant = false;

const REASON_LABEL: Record<string, string> = {
  opening: "Opening count",
  purchase: "Received",
  brew_usage: "Used in brew",
  adjustment: "Adjustment",
  spoilage: "Spoilage",
};

type LedgerRow = {
  id: string;
  qty_change: number;
  reason: string;
  unit_cost: number | null;
  note: string | null;
  created_at: string;
  batch_id: string | null;
  batches: { recipe_name: string; batch_number: string | null } | null;
};

export default async function IngredientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: ing }, { data: stock }, { data: ledger }, { data: catalog }, { data: recipes }] =
    await Promise.all([
      // "*" so pack columns come through when product-details.sql has run.
      supabase.from("ingredients").select("*").eq("id", id).maybeSingle(),
      supabase.from("ingredient_stock").select("on_hand,inventory_value").eq("id", id).maybeSingle(),
      fetchAll((a, b) =>
        supabase
          .from("inventory_transactions")
          .select("id,qty_change,reason,unit_cost,note,created_at,batch_id,batches(recipe_name,batch_number)")
          .eq("ingredient_id", id)
          .order("created_at", { ascending: false })
          .order("id")
          .range(a, b)
      ),
      supabase.from("ingredients").select("id,name,unit,cost_per_unit"),
      supabase.from("recipes").select("id,name,ingredients").order("name"),
    ]);
  if (!ing) notFound();

  const rows = ledger as unknown as LedgerRow[];
  const hasPackColumns = "pack_size" in ing;
  const onHand = Number(stock?.on_hand ?? 0);
  const cost = ing.cost_per_unit != null ? Number(ing.cost_per_unit) : null;
  const value = stock?.inventory_value != null ? Number(stock.inventory_value) : null;
  const short = onHand < 0;
  const low = !short && ing.low_stock_threshold != null && onHand <= Number(ing.low_stock_threshold);

  // Recipes whose bill prices against this ingredient — the same matcher
  // the recipe cost sheet and order planner use, so this list is exactly
  // where a price change here shows up.
  const items = ((catalog ?? []) as CatalogItem[]).map((c) => ({
    ...c,
    cost_per_unit: c.cost_per_unit != null ? Number(c.cost_per_unit) : null,
  }));
  const usedIn: { id: string; name: string; amount: number | null; unit: string; lineCost: number | null }[] = [];
  for (const r of recipes ?? []) {
    for (const line of (Array.isArray(r.ingredients) ? r.ingredients : []) as RecipeLine[]) {
      if (matchCatalog(line.name, items)?.id !== id) continue;
      const qty = line.amount != null ? convertUnits(line.amount, line.unit, ing.unit) : null;
      usedIn.push({
        id: r.id,
        name: r.name,
        amount: line.amount,
        unit: line.unit,
        lineCost: qty != null && cost != null ? qty * cost : null,
      });
    }
  }

  const purchases = rows.filter((r) => r.reason === "purchase" && r.unit_cost != null);
  const lastPaid = purchases[0];

  const qtyFmt = (n: number) => (n % 1 === 0 ? n.toFixed(0) : n.toFixed(2));

  return (
    <div>
      <Link href="/inventory" className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 transition hover:text-copper-700">
        <ArrowLeft className="h-4 w-4" /> Inventory
      </Link>

      <div className="mt-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-copper-700">
          {CATEGORIES[ing.category] ?? ing.category}
          {ing.supplier ? ` · ${ing.supplier}` : ""}
        </p>
        <h1 className="font-display text-4xl font-semibold uppercase tracking-wide text-ink-900">{ing.name}</h1>
      </div>

      <div className="tnum mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "On hand",
            value: `${qtyFmt(onHand)} ${ing.unit}`,
            sub: short ? "SHORT: ledger is negative" : low ? "Below low-stock alert" : null,
            warn: short || low,
          },
          {
            label: "Avg cost",
            value: cost != null ? `${formatUnitCost(cost)}/${ing.unit}` : "Not priced",
            sub: hasPackColumns && ing.pack_size && cost != null
              ? `${ing.pack_label ?? "pack"} of ${ing.pack_size} ${ing.unit} ≈ $${(cost * Number(ing.pack_size)).toFixed(2)}`
              : null,
          },
          {
            label: "Last paid",
            value: lastPaid ? `${formatUnitCost(Number(lastPaid.unit_cost))}/${ing.unit}` : "—",
            sub: lastPaid ? new Date(lastPaid.created_at).toLocaleDateString() : "no invoice yet",
          },
          {
            label: "Value on hand",
            value: value != null ? `$${Math.max(0, value).toFixed(2)}` : "—",
            sub: null,
          },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-stone-200 bg-white px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-400">{s.label}</div>
            <div className={`mt-0.5 text-xl font-semibold ${s.warn ? "text-red-600" : "text-stone-900"}`}>{s.value}</div>
            {s.sub && <div className={`text-[11px] ${s.warn ? "text-red-600" : "text-stone-500"}`}>{s.sub}</div>}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <IngredientEditForm
            ingredient={{
              id: ing.id,
              name: ing.name,
              category: ing.category,
              supplier: ing.supplier,
              unit: ing.unit,
              cost_per_unit: cost,
              low_stock_threshold: ing.low_stock_threshold != null ? Number(ing.low_stock_threshold) : null,
              pack_size: hasPackColumns && ing.pack_size != null ? Number(ing.pack_size) : null,
              pack_label: hasPackColumns ? (ing.pack_label ?? null) : null,
            }}
            unitLocked={rows.length > 0}
            hasPackColumns={hasPackColumns}
          />

          <Card title="Priced into recipes">
            {usedIn.length === 0 ? (
              <p className="-my-1 text-sm text-stone-500">No synced recipe matches this ingredient.</p>
            ) : (
              <ul className="-my-1 divide-y divide-stone-100 text-sm">
                {usedIn.map((u, i) => (
                  <li key={`${u.id}-${i}`} className="flex items-baseline justify-between gap-3 py-1.5">
                    <Link href={`/recipes/${u.id}`} className="font-medium text-stone-800 hover:text-copper-700">
                      {u.name}
                    </Link>
                    <span className="tnum shrink-0 text-stone-500">
                      {u.amount ?? "—"} {u.unit}
                      {u.lineCost != null && <span className="ml-2 font-semibold text-stone-800">${u.lineCost.toFixed(2)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card title={`Movement history (${rows.length})`}>
            {rows.length === 0 ? (
              <p className="-my-1 text-sm text-stone-500">No movements yet: receive it on an invoice or log a movement.</p>
            ) : (
              <div className="-mx-5 -my-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                      <th className="px-5 py-2.5 font-semibold">Date</th>
                      <th className="px-3 py-2.5 font-semibold">What</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                      <th className="px-5 py-2.5 text-right font-semibold">$/{ing.unit}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {rows.map((r) => {
                      const q = Number(r.qty_change);
                      return (
                        <tr key={r.id} className="align-top transition hover:bg-stone-50">
                          <td className="whitespace-nowrap px-5 py-2.5 text-stone-600">
                            {new Date(r.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="font-medium text-stone-800">{REASON_LABEL[r.reason] ?? r.reason}</span>
                            {r.batch_id && r.batches && (
                              <Link href={`/batches/${r.batch_id}`} className="ml-1.5 text-copper-700 hover:underline">
                                {r.batches.recipe_name}
                                {r.batches.batch_number ? ` #${r.batches.batch_number}` : ""}
                              </Link>
                            )}
                            {r.note && <span className="block text-xs text-stone-500">{r.note}</span>}
                          </td>
                          <td className={`tnum whitespace-nowrap px-3 py-2.5 text-right font-semibold ${q < 0 ? "text-stone-700" : "text-emerald-700"}`}>
                            {q > 0 ? "+" : ""}
                            {qtyFmt(q)} <span className="text-xs font-normal text-stone-400">{ing.unit}</span>
                          </td>
                          <td className="tnum px-5 py-2.5 text-right text-stone-500">
                            {r.unit_cost != null ? formatUnitCost(Number(r.unit_cost)) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
