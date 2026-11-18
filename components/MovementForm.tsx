"use client";

import { useState, useTransition } from "react";
import { adjustIngredient } from "@/lib/actions";
import { Card, inputCls, labelCls, primaryBtn } from "@/components/ui";

/** Log grain/adjunct movement: used on a brew, received, or corrected. */
export default function MovementForm({
  ingredients,
}: {
  ingredients: { id: string; name: string; unit: string }[];
}) {
  const [ingredientId, setIngredientId] = useState(ingredients[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [direction, setDirection] = useState<"use" | "receive" | "adjust">("use");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const n = parseFloat(qty);
    if (!ingredientId || !n || n <= 0) {
      setError("Pick an ingredient and enter a quantity.");
      return;
    }
    const signed = direction === "receive" ? n : -n;
    const reason =
      direction === "use" ? "brew_usage" : direction === "receive" ? "purchase" : "adjustment";
    startTransition(async () => {
      try {
        await adjustIngredient(
          ingredientId,
          signed,
          reason,
          note || undefined,
          undefined,
          direction === "receive" && unitPrice ? parseFloat(unitPrice) : undefined
        );
        setQty("");
        setNote("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card title="Log movement">
      <form onSubmit={submit} className="-my-1">
        <div className="grid grid-cols-3 rounded-lg border border-stone-300 p-0.5">
          {(
            [
              { v: "use", label: "Used" },
              { v: "receive", label: "Received" },
              { v: "adjust", label: "Adjust" },
            ] as const
          ).map((d) => (
            <button
              key={d.v}
              type="button"
              onClick={() => setDirection(d.v)}
              className={`rounded-md py-2 text-sm font-semibold transition ${
                direction === d.v ? "bg-ink-900 text-white" : "text-stone-500 hover:text-stone-800"
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label className={labelCls}>Ingredient</label>
          <select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} className={inputCls}>
            {ingredients.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Quantity (lb)</label>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="55" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className={inputCls} />
          </div>
        </div>

        {direction === "receive" && (
          <div className="mt-3">
            <label className={labelCls}>Price paid (per lb) — updates avg cost</label>
            <input value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} inputMode="decimal" placeholder="Optional, e.g. 0.62" className={inputCls} />
          </div>
        )}

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={pending} className={`${primaryBtn} mt-4 w-full`}>
          {pending ? "Saving…" : "Save movement"}
        </button>
      </form>
    </Card>
  );
}
