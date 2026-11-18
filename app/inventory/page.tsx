import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import MovementForm from "@/components/MovementForm";
import AddIngredientForm from "@/components/AddIngredientForm";
import VoiceCommandBar from "@/components/VoiceCommandBar";
import { PageHeader, Card } from "@/components/ui";
import { CATEGORIES } from "@/lib/categories";
import { convertUnits, formatUnitCost } from "@/lib/units";

export const instant = false;

export default async function InventoryPage() {
  const supabase = await createClient();
  const { data: stock } = await supabase.from("ingredient_stock").select("*").order("name");

  const PILLAR_ORDER = ["grain", "hops", "yeast", "adjunct", "water", "fining", "acid", "fruit", "cleaning", "gas", "packaging", "other"];
  const ALWAYS_SHOW = ["grain", "hops", "yeast", "adjunct"];
  const byCategory = new Map<string, NonNullable<typeof stock>>();
  for (const s of stock ?? []) {
    if (!byCategory.has(s.category)) byCategory.set(s.category, []);
    byCategory.get(s.category)!.push(s);
  }
  const orderedGroups = PILLAR_ORDER.filter(
    (cat) => ALWAYS_SHOW.includes(cat) || byCategory.has(cat)
  ).map((cat) => ({
    label: CATEGORIES[cat] ?? cat,
    items: byCategory.get(cat) ?? [],
  }));
  // Only weight items add up to pounds; oz of hops convert, packs and mL don't.
  const totalLbs = (stock ?? []).reduce(
    (n, s) => n + Math.max(0, convertUnits(Number(s.on_hand), s.unit, "lb") ?? 0),
    0
  );
  const totalValue = (stock ?? []).reduce((n, s) => n + Number(s.inventory_value ?? 0), 0);
  const hasCosts = (stock ?? []).some((s) => s.cost_per_unit != null);

  return (
    <div>
      <PageHeader eyebrow="Inventory" title="Ingredient Inventory" />
      <VoiceCommandBar />

      <div className="mt-5 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3 space-y-4">
          {orderedGroups.map(({ label: group, items }) => (
            <Card key={group} title={group}>
              <div className="-mx-5 -my-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                      <th className="px-5 py-2.5 font-semibold">Item</th>
                      <th className="px-3 py-2.5 font-semibold">Supplier</th>
                      <th className="px-3 py-2.5 text-right font-semibold">Avg cost</th>
                      <th className="px-5 py-2.5 text-right font-semibold">On hand</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {items.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-5 py-5 text-sm text-stone-400">
                          Nothing on hand yet — items appear here from Brewfather sync, invoices, or the Add Ingredient form.
                        </td>
                      </tr>
                    )}
                    {items.map((s) => {
                      const short = Number(s.on_hand) < 0;
                      const low =
                        short ||
                        (s.low_stock_threshold != null &&
                          Number(s.on_hand) <= Number(s.low_stock_threshold));
                      return (
                        <tr key={s.id} className="transition hover:bg-stone-50">
                          <td className="px-5 py-3 font-medium text-stone-900">
                            <Link href={`/inventory/${s.id}`} className="hover:text-copper-700 hover:underline">
                              {s.name}
                            </Link>
                          </td>
                          <td className="px-3 py-3 text-stone-500">{s.supplier ?? "—"}</td>
                          <td className="tnum px-3 py-3 text-right text-stone-600">
                            {s.cost_per_unit != null ? (
                              <>
                                {formatUnitCost(Number(s.cost_per_unit))}
                                <span className="text-xs text-stone-400">/{s.unit}</span>
                              </>
                            ) : (
                              <span className="text-stone-300">—</span>
                            )}
                          </td>
                          <td className={`tnum px-5 py-3 text-right font-semibold ${low ? "text-red-600" : "text-stone-900"}`}>
                            {Number(s.on_hand).toFixed(Number(s.on_hand) % 1 === 0 ? 0 : 1)}{" "}
                            <span className="text-xs font-normal text-stone-400">{s.unit}</span>
                            {low && (
                              <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700 ring-1 ring-inset ring-red-600/20">
                                {short ? "Short" : "Low"}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
          <p className="px-1 text-xs text-stone-400">
            Total weight on hand: <span className="tnum font-medium text-stone-600">{totalLbs.toFixed(0)} lb</span>
            {hasCosts && (
              <> · Inventory value: <span className="tnum font-medium text-stone-600">${totalValue.toFixed(2)}</span></>
            )}{" "}
            · Costs update automatically from posted invoices. Every movement is kept in a permanent ledger — counts are always the sum of recorded movements.
          </p>
        </div>

        <div className="lg:col-span-2">
          <div className="space-y-4 lg:sticky lg:top-6">
            <MovementForm
              ingredients={(stock ?? []).map((s) => ({ id: s.id, name: s.name, unit: s.unit }))}
            />
            <AddIngredientForm />
          </div>
        </div>
      </div>
    </div>
  );
}
