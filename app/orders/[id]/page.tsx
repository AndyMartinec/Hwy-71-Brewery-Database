import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card, Stat } from "@/components/ui";
import OrderActions from "@/components/OrderActions";

export const instant = false;

const money2 = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: order }, { data: lines }] = await Promise.all([
    supabase.from("ingredient_orders").select("id,status,note,created_at,sent_at").eq("id", id).single(),
    supabase
      .from("ingredient_order_lines")
      .select("ingredient_name,supplier,qty,unit,unit_cost,note")
      .eq("order_id", id)
      .order("supplier")
      .order("ingredient_name"),
  ]);
  if (!order) notFound();

  const ls = ((lines ?? []) as unknown as {
    ingredient_name: string;
    supplier: string | null;
    qty: number;
    unit: string;
    unit_cost: number | null;
    note: string | null;
  }[]);
  const estTotal = ls.reduce(
    (n, l) => n + (l.unit_cost != null ? Number(l.qty) * Number(l.unit_cost) : 0),
    0
  );
  const date = new Date(order.created_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const bySupplier = new Map<string, typeof ls>();
  for (const l of ls) {
    const s = l.supplier ?? "Supplier not listed";
    bySupplier.set(s, [...(bySupplier.get(s) ?? []), l]);
  }

  return (
    <div>
      <PageHeader
        eyebrow="Brew plan"
        title={order.note?.trim() || "Ingredient order"}
        action={
          <Link href="/orders" className="text-sm font-semibold text-copper-700 hover:underline">
            ← All orders
          </Link>
        }
      />
      <p className="mb-5 -mt-3 text-sm text-stone-500">
        Created {date}
        {order.status === "sent" && order.sent_at
          ? ` · sent ${new Date(order.sent_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
          : " · draft — not sent yet"}
      </p>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Lines" value={String(ls.length)} sub="ingredients on this order" />
        <Stat label="Estimated total" value={money2(estTotal)} sub="priced lines only — confirm with the supplier" />
        <Stat
          label="Status"
          value={order.status === "sent" ? "Sent" : "Draft"}
          sub={order.status === "sent" ? "with the supplier" : "save it, then mark sent once it's sent"}
        />
      </div>

      <OrderActions orderId={order.id} status={order.status} note={order.note} lines={ls} />

      <div className="mt-4 space-y-4">
        {[...bySupplier.entries()].map(([supplier, rows]) => (
          <Card key={supplier} title={supplier}>
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                    <th className="px-5 py-2.5 font-semibold">Ingredient</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Unit cost</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Line total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((l) => (
                    <tr key={`${l.ingredient_name}-${l.unit}`} className="transition hover:bg-stone-50">
                      <td className="px-5 py-3 font-medium text-stone-900">
                        {l.ingredient_name}
                        {l.note && <span className="block text-xs font-normal text-amber-700">{l.note}</span>}
                      </td>
                      <td className="tnum px-3 py-3 text-right text-stone-600">
                        {Number(l.qty)} {l.unit}
                      </td>
                      <td className="tnum px-3 py-3 text-right text-stone-600">
                        {l.unit_cost != null ? money2(Number(l.unit_cost)) : "—"}
                      </td>
                      <td className="tnum px-5 py-3 text-right font-semibold text-stone-900">
                        {l.unit_cost != null ? money2(Number(l.qty) * Number(l.unit_cost)) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-3 px-1 text-xs text-stone-400">
        This order is a snapshot — later inventory moves never change it. When
        the delivery lands, post the supplier invoice on the Invoices page and
        stock + costs update from the real prices.
      </p>
    </div>
  );
}
