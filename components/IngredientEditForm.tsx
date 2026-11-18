"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateIngredient } from "@/lib/actions";
import { CATEGORIES } from "@/lib/categories";
import { Card, inputCls, labelCls, primaryBtn } from "@/components/ui";
import { Lock } from "lucide-react";

export interface EditableIngredient {
  id: string;
  name: string;
  category: string;
  supplier: string | null;
  unit: string;
  cost_per_unit: number | null;
  low_stock_threshold: number | null;
  pack_size: number | null;
  pack_label: string | null;
}

const str = (n: number | null) => (n != null ? String(n) : "");
/** "" → null, otherwise a number (NaN is caught by the server). */
const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));

/** Edit an ingredient's saved product details (price, unit, pack size…). */
export default function IngredientEditForm({
  ingredient,
  unitLocked,
  hasPackColumns,
}: {
  ingredient: EditableIngredient;
  /** Ledger rows exist, so the unit can't change. */
  unitLocked: boolean;
  /** supabase/product-details.sql has run. */
  hasPackColumns: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState(ingredient.name);
  const [category, setCategory] = useState(ingredient.category);
  const [supplier, setSupplier] = useState(ingredient.supplier ?? "");
  const [unit, setUnit] = useState(ingredient.unit);
  const [cost, setCost] = useState(str(ingredient.cost_per_unit));
  const [threshold, setThreshold] = useState(str(ingredient.low_stock_threshold));
  const [packSize, setPackSize] = useState(str(ingredient.pack_size));
  const [packLabel, setPackLabel] = useState(ingredient.pack_label ?? "bag");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const costNum = numOrNull(cost);
  const packNum = numOrNull(packSize);
  const packCost =
    costNum != null && packNum != null && costNum >= 0 && packNum > 0 ? costNum * packNum : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaved(false);
    startTransition(async () => {
      try {
        await updateIngredient(ingredient.id, {
          name,
          category,
          supplier: supplier || null,
          unit,
          cost_per_unit: costNum,
          low_stock_threshold: numOrNull(threshold),
          ...(hasPackColumns ? { pack: { size: packNum, label: packLabel || null } } : {}),
        });
        setSaved(true);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  const changed = () => setSaved(false);

  return (
    <Card title="Product details">
      <form onSubmit={submit} onChange={changed} className="-my-1">
        <div>
          <label className={labelCls}>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
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
            <div className="relative">
              <input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                disabled={unitLocked}
                className={`${inputCls} ${unitLocked ? "bg-stone-50 pr-9 text-stone-500" : ""}`}
              />
              {unitLocked && <Lock className="absolute right-3 top-3 h-4 w-4 text-stone-400" />}
            </div>
          </div>
          <div>
            <label className={labelCls}>Cost per {unit || "unit"} $</label>
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="Not priced" className={inputCls} />
          </div>
          {hasPackColumns && (
            <>
              <div>
                <label className={labelCls}>Sold by the</label>
                <input value={packLabel} onChange={(e) => setPackLabel(e.target.value)} placeholder="bag, box, case" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Pack size ({unit || "unit"})</label>
                <input value={packSize} onChange={(e) => setPackSize(e.target.value)} inputMode="decimal" placeholder="e.g. 55" className={inputCls} />
              </div>
            </>
          )}
          <div className="col-span-2">
            <label className={labelCls}>Low-stock alert at ({unit || "unit"})</label>
            <input value={threshold} onChange={(e) => setThreshold(e.target.value)} inputMode="decimal" placeholder="No alert" className={inputCls} />
          </div>
        </div>

        <div className="mt-3 space-y-1 text-xs text-stone-500">
          {packCost != null && (
            <p className="tnum">
              One {packLabel || "pack"} = {packNum} {unit} ≈{" "}
              <span className="font-semibold text-stone-700">${packCost.toFixed(2)}</span> at this cost.
            </p>
          )}
          {unitLocked && (
            <p>Unit is locked: stock has moved, and past quantities are recorded in {ingredient.unit}.</p>
          )}
          {!hasPackColumns && (
            <p>Run supabase/product-details.sql to save a pack size (e.g. bag = 55 lb).</p>
          )}
          <p>
            A cost entered here is the working price for recipe costing. The next posted invoice
            blends real prices in as a weighted average. To correct a count, log an adjustment
            instead: on-hand is always the sum of the ledger.
          </p>
        </div>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="mt-4 flex items-center gap-3">
          <button disabled={pending} className={`${primaryBtn} flex-1`}>
            {pending ? "Saving…" : "Save details"}
          </button>
          {saved && !pending && <span className="text-sm font-medium text-emerald-700">✓ Saved</span>}
        </div>
      </form>
    </Card>
  );
}
