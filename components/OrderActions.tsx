"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markOrderSent, deleteIngredientOrder } from "@/lib/actions";
import PrintButton from "@/components/PrintButton";
import { primaryBtn } from "@/components/ui";

export interface OrderActionLine {
  ingredient_name: string;
  supplier: string | null;
  qty: number;
  unit: string;
  unit_cost: number | null;
}

/** Actions on a saved order: mark sent, delete a draft, copy the order text. */
export default function OrderActions({
  orderId,
  status,
  note,
  lines,
}: {
  orderId: string;
  status: string;
  note: string | null;
  lines: OrderActionLine[];
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const estTotal = lines.reduce(
    (n, l) => n + (l.unit_cost != null ? Number(l.qty) * Number(l.unit_cost) : 0),
    0
  );

  function orderText(): string {
    const bySupplier = new Map<string, OrderActionLine[]>();
    for (const l of lines) {
      const s = l.supplier ?? "Supplier TBD";
      bySupplier.set(s, [...(bySupplier.get(s) ?? []), l]);
    }
    const parts = ["Ingredient order — Highway 71 Brewing"];
    if (note?.trim()) parts.push(note.trim());
    for (const [supplier, ls] of bySupplier) {
      parts.push("", supplier);
      for (const l of ls) {
        const cost = l.unit_cost != null ? ` @ $${Number(l.unit_cost).toFixed(2)}/${l.unit}` : "";
        parts.push(`- ${Number(l.qty)} ${l.unit} ${l.ingredient_name}${cost}`);
      }
    }
    parts.push("", `Estimated total: $${estTotal.toFixed(2)} (priced lines only)`);
    return parts.join("\n");
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {status === "draft" && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await markOrderSent(orderId);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              })
            }
            className={primaryBtn}
          >
            {pending ? "Saving…" : "Mark sent"}
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(orderText());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="rounded-lg border border-stone-300 px-4 py-2.5 font-semibold text-stone-700 transition hover:border-copper-400"
        >
          {copied ? "Copied!" : "Copy order text"}
        </button>
        <PrintButton />
        {status === "draft" && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await deleteIngredientOrder(orderId);
                  router.push("/orders");
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              })
            }
            className="rounded-lg border border-red-200 px-4 py-2.5 font-semibold text-red-700 transition hover:border-red-400"
          >
            Delete draft
          </button>
        )}
      </div>
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
