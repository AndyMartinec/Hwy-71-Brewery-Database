"use client";

import { useState, useTransition } from "react";
import { createIngredient } from "@/lib/actions";
import { CATEGORIES } from "@/lib/categories";
import { Card, inputCls, labelCls, primaryBtn } from "@/components/ui";
import { ChevronDown } from "lucide-react";

/** Add a new ingredient to the catalog (any category, with starting cost). */
export default function AddIngredientForm() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("grain");
  const [supplier, setSupplier] = useState("");
  const [unit, setUnit] = useState("lb");
  const [cost, setCost] = useState("");
  const [threshold, setThreshold] = useState("");
  const [packSize, setPackSize] = useState("");
  const [packLabel, setPackLabel] = useState("bag");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("Give the ingredient a name.");
      return;
    }
    startTransition(async () => {
      try {
        await createIngredient({
          name: name.trim(),
          category,
          supplier: supplier.trim() || undefined,
          unit: unit || "lb",
          cost_per_unit: cost ? parseFloat(cost) : null,
          low_stock_threshold: threshold ? parseFloat(threshold) : null,
          pack_size: packSize ? parseFloat(packSize) : null,
          pack_label: packSize ? packLabel.trim() || null : null,
        });
        setPackSize("");
        setName("");
        setSupplier("");
        setCost("");
        setThreshold("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card
      title="Add ingredient"
      action={
        <button
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-copper-700 hover:underline"
        >
          {open ? "Close" : "New"}
          <ChevronDown className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
        </button>
      }
    >
      {open ? (
        <form onSubmit={submit} className="-my-1">
          <div>
            <label className={labelCls}>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Whirlfloc Tablets" className={inputCls} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Category</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
                {Object.entries(CATEGORIES).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Supplier</label>
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Optional" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Unit</label>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="lb" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Cost per {unit || "unit"} $</label>
              <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="Optional" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Sold by the</label>
              <input value={packLabel} onChange={(e) => setPackLabel(e.target.value)} placeholder="bag, box, case" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Pack size ({unit || "lb"})</label>
              <input value={packSize} onChange={(e) => setPackSize(e.target.value)} inputMode="decimal" placeholder="e.g. 55" className={inputCls} />
            </div>
            <div className="col-span-2">
              <label className={labelCls}>Low-stock alert at</label>
              <input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" placeholder="Optional" className={inputCls} />
            </div>
          </div>
          {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={pending} className={`${primaryBtn} mt-4 w-full`}>
            {pending ? "Saving…" : "Add ingredient"}
          </button>
        </form>
      ) : (
        <p className="-my-1 text-sm text-stone-500">
          New malts, hops, salts, finings, chemicals — anything the brewery buys.
        </p>
      )}
    </Card>
  );
}
