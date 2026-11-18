"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createIngredientOrder, type OrderLineInput } from "@/lib/actions";
import { matchCatalog, convertWeight, type CatalogItem, type RecipeLine } from "@/lib/recipe-cost";
import { normalizeName } from "@/lib/match";
import { Card, inputCls, labelCls, primaryBtn } from "@/components/ui";

export interface PlannerRecipe {
  id: string;
  name: string;
  batch_size_gal: number | null;
  ingredients: RecipeLine[];
}

export interface PlannerStockItem extends CatalogItem {
  supplier: string | null;
  on_hand: number;
}

interface Need {
  key: string;
  ingredientId: string | null;
  name: string;
  unit: string;
  supplier: string | null;
  unitCost: number | null;
  needed: number;
  onHand: number | null;
  shortfall: number;
  flag?: string;
}

/** Pick recipes for the next brew cycle -> totals every ingredient needed,
 *  subtracts what's on hand, and the shortfall is the order. Quantities are
 *  editable before saving; the saved order is a snapshot. */
export default function OrderPlanner({
  recipes,
  stock,
}: {
  recipes: PlannerRecipe[];
  stock: PlannerStockItem[];
}) {
  const router = useRouter();
  const [picks, setPicks] = useState<Record<string, number>>({});
  const [qtyOverrides, setQtyOverrides] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const catalog: CatalogItem[] = stock.map((s) => ({
    id: s.id,
    name: s.name,
    unit: s.unit,
    cost_per_unit: s.cost_per_unit,
  }));
  const stockById = new Map(stock.map((s) => [s.id, s]));

  const needs = useMemo(() => {
    const map = new Map<string, Need>();
    for (const recipe of recipes) {
      const batches = picks[recipe.id] ?? 0;
      if (batches <= 0) continue;
      for (const line of recipe.ingredients) {
        if (line.amount == null) continue;
        const total = Number(line.amount) * batches;
        const match = matchCatalog(line.name, catalog);
        if (!match) {
          const key = `nomatch:${normalizeName(line.name)}`;
          const row = map.get(key) ?? {
            key,
            ingredientId: null,
            name: line.name,
            unit: line.unit,
            supplier: null,
            unitCost: null,
            needed: 0,
            onHand: 0,
            shortfall: 0,
            flag: "Not in inventory — verify name with the supplier.",
          };
          row.needed += total;
          row.shortfall = row.needed;
          map.set(key, row);
          continue;
        }
        const item = stockById.get(match.id)!;
        const converted = convertWeight(total, line.unit, match.unit);
        if (converted == null) {
          const key = `unconv:${match.id}`;
          const row = map.get(key) ?? {
            key,
            ingredientId: match.id,
            name: match.name,
            unit: line.unit,
            supplier: item.supplier,
            unitCost: null,
            needed: 0,
            onHand: null,
            shortfall: 0,
            flag: `Can't convert ${line.unit} to on-hand unit ${match.unit} — check before ordering.`,
          };
          row.needed += total;
          row.shortfall = row.needed;
          map.set(key, row);
          continue;
        }
        const row = map.get(match.id) ?? {
          key: match.id,
          ingredientId: match.id,
          name: match.name,
          unit: match.unit,
          supplier: item.supplier,
          unitCost: item.cost_per_unit != null ? Number(item.cost_per_unit) : null,
          needed: 0,
          onHand: Number(item.on_hand),
          shortfall: 0,
        };
        row.needed += converted;
        row.shortfall = Math.max(0, row.needed - (row.onHand ?? 0));
        map.set(match.id, row);
      }
    }
    return [...map.values()].sort((a, b) =>
      (a.supplier ?? "zzz").localeCompare(b.supplier ?? "zzz") || a.name.localeCompare(b.name)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picks, recipes, stock]);

  const orderNeeds = needs.filter((n) => n.shortfall > 0.005);
  const covered = needs.filter((n) => n.shortfall <= 0.005 && n.onHand != null);

  const qtyFor = (n: Need) => {
    const override = qtyOverrides[n.key];
    if (override != null) return override;
    return String(Math.ceil(n.shortfall * 100) / 100);
  };

  const orderLines: OrderLineInput[] = orderNeeds.map((n) => ({
    ingredient_id: n.ingredientId,
    ingredient_name: n.name,
    supplier: n.supplier,
    qty: Number(qtyFor(n)) || 0,
    unit: n.unit,
    unit_cost: n.unitCost,
    note: n.flag ?? null,
  }));
  const estTotal = orderLines.reduce(
    (sum, l) => sum + (l.unit_cost != null ? l.qty * l.unit_cost : 0),
    0
  );
  const pickedCount = Object.values(picks).reduce((n, b) => n + b, 0);

  function orderText(): string {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const bySupplier = new Map<string, OrderLineInput[]>();
    for (const l of orderLines) {
      const s = l.supplier ?? "Supplier TBD";
      bySupplier.set(s, [...(bySupplier.get(s) ?? []), l]);
    }
    const parts = [`Ingredient order — Highway 71 Brewing — ${today}`];
    if (note.trim()) parts.push(note.trim());
    for (const [supplier, lines] of bySupplier) {
      parts.push("", supplier);
      for (const l of lines) {
        const cost = l.unit_cost != null ? ` @ $${Number(l.unit_cost).toFixed(2)}/${l.unit}` : "";
        parts.push(`- ${l.qty} ${l.unit} ${l.ingredient_name}${cost}`);
      }
    }
    parts.push("", `Estimated total: $${estTotal.toFixed(2)} (priced lines only)`);
    return parts.join("\n");
  }

  function save() {
    setError("");
    startTransition(async () => {
      try {
        const id = await createIngredientOrder(orderLines, note || undefined);
        router.push(`/orders/${id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card title="1 · Pick what to brew next">
        {recipes.length === 0 ? (
          <p className="py-1 text-sm text-stone-500">
            No recipes synced yet — sync from Brewfather first, then the brew
            plan can total the ingredients.
          </p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {recipes.map((r) => {
              const batches = picks[r.id] ?? 0;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={batches > 0}
                      onChange={(e) =>
                        setPicks((p) => ({ ...p, [r.id]: e.target.checked ? 1 : 0 }))
                      }
                      className="h-4 w-4 accent-amber-800"
                    />
                    <span>
                      <span className="block font-medium text-stone-900">{r.name}</span>
                      <span className="text-xs text-stone-500">
                        {r.batch_size_gal ? `${r.batch_size_gal} gal per batch` : "Batch size unknown"}
                        {` · ${r.ingredients.length} ingredients`}
                      </span>
                    </span>
                  </label>
                  {batches > 0 && (
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label="Fewer batches"
                        className="rounded-lg border border-stone-300 px-2.5 py-1 text-sm font-semibold"
                        onClick={() =>
                          setPicks((p) => ({ ...p, [r.id]: Math.max(1, batches - 1) }))
                        }
                      >
                        −
                      </button>
                      <span className="tnum w-16 text-center text-sm font-semibold">
                        {batches} batch{batches === 1 ? "" : "es"}
                      </span>
                      <button
                        type="button"
                        aria-label="More batches"
                        className="rounded-lg border border-stone-300 px-2.5 py-1 text-sm font-semibold"
                        onClick={() => setPicks((p) => ({ ...p, [r.id]: batches + 1 }))}
                      >
                        +
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {pickedCount > 0 && (
        <Card
          title="2 · What you need vs. what you have"
          action={
            <span className="text-xs font-medium normal-case tracking-normal text-stone-500">
              {pickedCount} batch{pickedCount === 1 ? "" : "es"} planned
            </span>
          }
        >
          {orderNeeds.length === 0 ? (
            <p className="py-1 text-sm text-stone-500">
              Everything for this plan is already on hand — nothing to order.
            </p>
          ) : (
            <>
              <div className="-mx-5 -my-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                      <th className="px-5 py-2.5 font-semibold">Ingredient</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Needed</th>
                      <th className="px-3 py-2.5 text-right font-semibold">On hand</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Shortfall</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Order qty</th>
                      <th className="px-5 py-2.5 text-right font-semibold">Est. cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {orderNeeds.map((n) => {
                      const qty = Number(qtyFor(n)) || 0;
                      return (
                        <tr key={n.key} className="transition hover:bg-stone-50">
                          <td className="px-5 py-3 font-medium text-stone-900">
                            {n.name}
                            <span className="block text-xs font-normal text-stone-400">
                              {n.supplier ?? "Supplier not listed"}
                              {n.flag ? ` · ${n.flag}` : ""}
                            </span>
                          </td>
                          <td className="tnum px-3 py-3 text-right text-stone-600">
                            {n.needed.toFixed(2)} {n.unit}
                          </td>
                          <td className="tnum px-3 py-3 text-right text-stone-600">
                            {n.onHand != null ? `${n.onHand.toFixed(2)} ${n.unit}` : "—"}
                          </td>
                          <td className="tnum px-3 py-3 text-right font-semibold text-amber-800">
                            {n.shortfall.toFixed(2)} {n.unit}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={qtyFor(n)}
                              onChange={(e) =>
                                setQtyOverrides((o) => ({ ...o, [n.key]: e.target.value }))
                              }
                              className="tnum w-24 rounded-lg border border-stone-300 px-2 py-1.5 text-right text-sm"
                            />
                          </td>
                          <td className="tnum px-5 py-3 text-right text-stone-600">
                            {n.unitCost != null ? `$${(qty * n.unitCost).toFixed(2)}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 border-stone-200 font-semibold">
                      <td className="px-5 py-3 text-stone-900">Estimated total</td>
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3" />
                      <td className="px-3 py-3" />
                      <td className="tnum px-5 py-3 text-right">${estTotal.toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-3 border-t border-stone-100 pt-3 text-xs text-stone-400">
                Order quantities default to the shortfall (rounded up) and are
                editable — round up to full bags with your supplier before
                sending. Estimated cost uses the current average cost per unit;
                lines with no cost show —.
              </p>
            </>
          )}

          {covered.length > 0 && (
            <p className="mt-3 text-xs text-stone-500">
              Already covered by stock: {covered.map((n) => n.name).join(", ")}.
            </p>
          )}

          <div className="mt-4">
            <label className={labelCls}>Order note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Brew cycle Nov 10 — need by Friday"
              className={inputCls}
            />
          </div>
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || orderNeeds.length === 0}
              onClick={save}
              className={primaryBtn}
            >
              {pending ? "Saving…" : "3 · Save order"}
            </button>
            <button
              type="button"
              disabled={orderNeeds.length === 0}
              onClick={async () => {
                await navigator.clipboard.writeText(orderText());
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="rounded-lg border border-stone-300 px-4 py-2.5 font-semibold text-stone-700 transition hover:border-copper-400"
            >
              {copied ? "Copied!" : "Copy order text"}
            </button>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Save it first, then mark it sent from the order page once it&apos;s
            with the supplier — or copy the text straight into an email.
          </p>
        </Card>
      )}
    </div>
  );
}
