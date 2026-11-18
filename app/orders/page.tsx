import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { PageHeader, Card, Stat } from "@/components/ui";
import OrderPlanner, { type PlannerRecipe, type PlannerStockItem } from "@/components/OrderPlanner";
import type { RecipeLine } from "@/lib/recipe-cost";

export const instant = false;

const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export default async function OrdersPage() {
  const supabase = await createClient();
  const [{ data: recipes }, { data: stock }, { data: orders }, { data: lines }] = await Promise.all([
    supabase.from("recipes").select("id,name,batch_size_gal,ingredients").order("name"),
    supabase.from("ingredient_stock").select("id,name,category,supplier,unit,cost_per_unit,on_hand").order("name"),
    supabase
      .from("ingredient_orders")
      .select("id,status,note,created_at,sent_at")
      .order("created_at", { ascending: false }),
    fetchAll((a, b) =>
      supabase
        .from("ingredient_order_lines")
        .select("order_id,qty,unit_cost")
        .order("created_at")
        .order("id")
        .range(a, b)
    ),
  ]);

  const plannerRecipes: PlannerRecipe[] = ((recipes ?? []) as unknown as {
    id: string;
    name: string;
    batch_size_gal: number | null;
    ingredients: unknown;
  }[]).map((r) => ({
    id: r.id,
    name: r.name,
    batch_size_gal: r.batch_size_gal != null ? Number(r.batch_size_gal) : null,
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []) as RecipeLine[],
  }));
  const plannerStock = ((stock ?? []) as unknown as PlannerStockItem[]).map((s) => ({
    ...s,
    cost_per_unit: s.cost_per_unit != null ? Number(s.cost_per_unit) : null,
    on_hand: Number(s.on_hand),
  }));

  const totals = new Map<string, { lines: number; cost: number }>();
  for (const l of (lines ?? []) as unknown as { order_id: string; qty: number; unit_cost: number | null }[]) {
    const t = totals.get(l.order_id) ?? { lines: 0, cost: 0 };
    t.lines += 1;
    if (l.unit_cost != null) t.cost += Number(l.qty) * Number(l.unit_cost);
    totals.set(l.order_id, t);
  }

  const draftCount = (orders ?? []).filter((o) => o.status === "draft").length;

  return (
    <div>
      <PageHeader eyebrow="Brew plan" title="Orders" />
      <p className="mb-5 -mt-3 text-sm text-stone-500">
        Pick the recipes for the next brew cycle. The app totals every
        ingredient needed, subtracts what&apos;s on hand, and the shortfall
        becomes the order to send to the supplier.
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Recipes" value={String(plannerRecipes.length)} sub="synced from Brewfather" />
        <Stat label="Ingredients in stock" value={String(plannerStock.length)} sub="catalog items with on-hand counts" />
        <Stat label="Draft orders" value={String(draftCount)} sub="not yet sent" />
        <Stat label="Orders total" value={String((orders ?? []).length)} sub="draft + sent" />
      </div>

      <OrderPlanner recipes={plannerRecipes} stock={plannerStock} />

      <Card title="Past orders" className="mt-4">
        {(orders ?? []).length === 0 ? (
          <p className="py-1 text-sm text-stone-500">
            No orders yet. Plan a brew cycle above and save the shortfall as
            an order.
          </p>
        ) : (
          <ul className="-my-1 divide-y divide-stone-100 text-sm">
            {(orders ?? []).map((o) => {
              const t = totals.get(o.id) ?? { lines: 0, cost: 0 };
              const date = new Date(o.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              });
              return (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="flex items-baseline justify-between gap-3 py-2.5 transition hover:bg-stone-50">
                    <span className="font-medium text-stone-800">
                      {o.note?.trim() || `Order ${date}`}
                      <span className="ml-2 text-xs font-normal text-stone-400">
                        {date} · {t.lines} line{t.lines === 1 ? "" : "s"}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="tnum font-semibold text-stone-900">{money2(t.cost)}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                          o.status === "sent"
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-600/25"
                            : "bg-amber-50 text-amber-800 ring-amber-600/25"
                        }`}
                      >
                        {o.status === "sent" ? "Sent" : "Draft"}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
