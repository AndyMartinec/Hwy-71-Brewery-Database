"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  updateInvoiceHeader,
  updateInvoiceLine,
  addInvoiceLine,
  removeInvoiceLine,
  postInvoice,
  deleteInvoice,
} from "@/lib/invoice-actions";
import { CATEGORIES } from "@/lib/categories";
import { Card, inputCls, labelCls } from "@/components/ui";
import { Plus, Trash2, Check, Sparkles } from "lucide-react";
import { suggestQtyToAdd, unitsMismatch, type QtySuggestion } from "@/lib/receiving";
import { formatUnitCost } from "@/lib/units";

type Ingredient = {
  id: string;
  name: string;
  unit: string;
  pack_size?: number | null;
  pack_unit?: string | null;
};

interface LineState {
  id: string;
  raw_name: string;
  qty: string;
  unit: string;
  unit_price: string;
  line_total: string;
  ingredient_id: string;
  qty_to_add: string;
  isNew: boolean;
  new_name: string;
  new_category: string;
  new_unit: string;
  /** The reviewer typed qty_to_add themselves; stop auto-suggesting. */
  qtyTouched: boolean;
}

type InvoiceRow = {
  id: string;
  supplier: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  freight: number;
  tax: number;
  total: number | null;
  file_name: string | null;
};

type LineRow = {
  id: string;
  raw_name: string;
  qty: number | null;
  unit: string | null;
  unit_price: number | null;
  line_total: number | null;
  ingredient_id: string | null;
  qty_to_add: number | null;
  new_name: string | null;
  new_category: string | null;
  new_unit: string | null;
};

const num = (s: string): number | null => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

export default function InvoiceReview({
  invoice,
  lines,
  ingredients,
  hasAiKey,
}: {
  invoice: InvoiceRow;
  lines: LineRow[];
  ingredients: Ingredient[];
  hasAiKey: boolean;
}) {
  const ingById = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);

  /** The unit the line will land in: the matched ingredient's, or the new one's. */
  function targetUnit(r: Pick<LineState, "isNew" | "ingredient_id" | "new_unit">): string | null {
    if (r.isNew) return r.new_unit || null;
    return ingById.get(r.ingredient_id)?.unit ?? null;
  }

  function suggestionFor(r: LineState): QtySuggestion | null {
    const unit = targetUnit(r);
    if (!unit) return null;
    const ing = r.isNew ? null : ingById.get(r.ingredient_id) ?? null;
    return suggestQtyToAdd(
      { raw_name: r.raw_name, qty: num(r.qty), unit: r.unit || null },
      unit,
      ing
    );
  }

  const router = useRouter();
  const [supplier, setSupplier] = useState(invoice.supplier ?? "");
  const [number, setNumber] = useState(invoice.invoice_number ?? "");
  const [date, setDate] = useState(invoice.invoice_date ?? "");
  const [freight, setFreight] = useState(String(invoice.freight || ""));
  const [tax, setTax] = useState(String(invoice.tax || ""));
  const [total, setTotal] = useState(invoice.total != null ? String(invoice.total) : "");
  const [rows, setRows] = useState<LineState[]>(() =>
    lines.map((l) => withSuggestion({
      id: l.id,
      raw_name: l.raw_name,
      qty: l.qty != null ? String(l.qty) : "",
      unit: l.unit ?? "",
      unit_price: l.unit_price != null ? String(l.unit_price) : "",
      line_total: l.line_total != null ? String(l.line_total) : "",
      ingredient_id: l.ingredient_id ?? "",
      qty_to_add: l.qty_to_add != null ? String(l.qty_to_add) : l.qty != null ? String(l.qty) : "",
      isNew: !l.ingredient_id && !!l.new_name,
      new_name: l.new_name ?? "",
      new_category: l.new_category ?? "other",
      new_unit: l.new_unit ?? "lb",
      qtyTouched: l.qty_to_add != null,
    }))
  );

  /** Fill qty_to_add from the unit/pack-size conversion unless the reviewer
   *  has typed their own number. */
  function withSuggestion(r: LineState): LineState {
    if (r.qtyTouched) return r;
    const s = suggestionFor(r);
    return s ? { ...r, qty_to_add: String(s.qty) } : r;
  }
  const [removed, setRemoved] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const linesSum = useMemo(
    () => rows.reduce((n, r) => n + (num(r.line_total) ?? 0), 0),
    [rows]
  );
  const computedTotal = linesSum + (num(freight) ?? 0) + (num(tax) ?? 0);
  const statedTotal = num(total);
  const diff = statedTotal != null ? statedTotal - computedTotal : null;

  function setRow(i: number, patch: Partial<LineState>) {
    setRows((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r;
        let next = { ...r, ...patch };
        if ("qty_to_add" in patch) next.qtyTouched = true;
        // Keep line total in sync when qty or unit price changes.
        if (("qty" in patch || "unit_price" in patch) && !("line_total" in patch)) {
          const q = num(next.qty);
          const p = num(next.unit_price);
          if (q != null && p != null) next.line_total = String(Math.round(q * p * 100) / 100);
        }
        if (!("qty_to_add" in patch)) next = withSuggestion(next);
        return next;
      })
    );
  }

  async function saveAll() {
    await updateInvoiceHeader(invoice.id, {
      supplier: supplier.trim() || null,
      invoice_number: number.trim() || null,
      invoice_date: date || null,
      freight: num(freight) ?? 0,
      tax: num(tax) ?? 0,
      total: num(total),
    });
    for (const rid of removed) await removeInvoiceLine(rid, invoice.id);
    for (const r of rows) {
      let id = r.id;
      if (id.startsWith("temp-")) {
        id = await addInvoiceLine(invoice.id);
      }
      await updateInvoiceLine(id, {
        raw_name: r.raw_name,
        qty: num(r.qty),
        unit: r.unit || null,
        unit_price: num(r.unit_price),
        line_total: num(r.line_total),
        ingredient_id: r.isNew ? null : r.ingredient_id || null,
        qty_to_add: num(r.qty_to_add),
        new_name: r.isNew ? r.new_name || r.raw_name : null,
        new_category: r.isNew ? r.new_category : null,
        new_unit: r.isNew ? r.new_unit : null,
      });
    }
  }

  function save(post: boolean) {
    setError("");
    if (post) {
      const bad = rows.find((r) => !r.isNew && !r.ingredient_id);
      if (bad) {
        setError(`"${bad.raw_name || "A line"}" isn't matched to an ingredient yet — match it or mark it as new.`);
        return;
      }
      const noQty = rows.find((r) => !(num(r.qty_to_add) != null && num(r.qty_to_add)! > 0));
      if (noQty) {
        setError(`"${noQty.raw_name || "A line"}" needs a quantity to add.`);
        return;
      }
      // "2 bag" posted into a lb item as 2 lb at $55/lb wrecks every cost
      // downstream. Make the reviewer say how many lb that is.
      const unconverted = rows.find((r) => {
        const unit = targetUnit(r);
        return (
          unit &&
          !r.qtyTouched &&
          !suggestionFor(r) &&
          unitsMismatch(r.unit || null, unit)
        );
      });
      if (unconverted) {
        setError(
          `"${unconverted.raw_name || "A line"}" is invoiced per ${unconverted.unit} but the ingredient is counted in ${targetUnit(unconverted)}. Enter how many ${targetUnit(unconverted)} that is in "Qty to add" (e.g. 2 bags × 55 lb = 110).`
        );
        return;
      }
      if (rows.length === 0) {
        setError("Add at least one line.");
        return;
      }
    }
    startTransition(async () => {
      try {
        await saveAll();
        if (post) {
          await postInvoice(invoice.id);
          router.push("/invoices");
        } else {
          router.refresh();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <div className="space-y-4">
      {!hasAiKey && invoice.file_name && (
        <p className="flex items-start gap-2 rounded-xl border border-copper-200 bg-copper-50 px-4 py-3 text-sm text-copper-800">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          Automatic invoice reading needs the OpenAI key (also powers voice commands). The file is
          saved — fill the lines in below this once, or add the key and re-upload.
        </p>
      )}

      <Card title="Invoice details">
        <div className="-my-1 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="col-span-2 sm:col-span-1">
            <label className={labelCls}>Supplier</label>
            <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="BSG, Country Malt…" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Invoice #</label>
            <input value={number} onChange={(e) => setNumber(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Freight $</label>
            <input value={freight} onChange={(e) => setFreight(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Tax $</label>
            <input value={tax} onChange={(e) => setTax(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Invoice total $</label>
            <input value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" placeholder="As printed" className={inputCls} />
          </div>
        </div>
      </Card>

      <Card
        title="Line items"
        action={
          <button
            onClick={() =>
              setRows((rs) => [
                ...rs,
                {
                  id: `temp-${Date.now()}-${rs.length}`,
                  raw_name: "", qty: "", unit: "", unit_price: "", line_total: "",
                  ingredient_id: "", qty_to_add: "",
                  isNew: false, new_name: "", new_category: "other", new_unit: "lb",
                  qtyTouched: false,
                },
              ])
            }
            className="inline-flex items-center gap-1 text-xs font-semibold text-copper-700 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        }
      >
        <div className="-my-1 space-y-4">
          {rows.length === 0 && (
            <p className="py-2 text-sm text-stone-500">No lines yet — add them one by one.</p>
          )}
          {rows.map((r, i) => (
            <div key={r.id} className="rounded-lg border border-stone-200 p-3.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <label className={labelCls}>As printed on invoice</label>
                  <input value={r.raw_name} onChange={(e) => setRow(i, { raw_name: e.target.value })} placeholder="Product name" className={inputCls} />
                </div>
                <button
                  onClick={() => {
                    if (!r.id.startsWith("temp-")) setRemoved((x) => [...x, r.id]);
                    setRows((rs) => rs.filter((_, j) => j !== i));
                  }}
                  className="mt-5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-300 text-stone-400 transition hover:border-red-300 hover:text-red-500"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-4 gap-2.5">
                <div>
                  <label className={labelCls}>Qty</label>
                  <input value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Unit</label>
                  <input value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} placeholder="lb" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Unit $</label>
                  <input value={r.unit_price} onChange={(e) => setRow(i, { unit_price: e.target.value })} inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Line $</label>
                  <input value={r.line_total} onChange={(e) => setRow(i, { line_total: e.target.value })} inputMode="decimal" className={inputCls} />
                </div>
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-[1fr_140px]">
                <div>
                  <label className={labelCls}>Goes into inventory as</label>
                  <select
                    value={r.isNew ? "__new__" : r.ingredient_id}
                    onChange={(e) =>
                      e.target.value === "__new__"
                        ? setRow(i, { isNew: true, new_name: r.new_name || r.raw_name })
                        : setRow(i, { isNew: false, ingredient_id: e.target.value })
                    }
                    className={inputCls}
                  >
                    <option value="">— pick ingredient —</option>
                    {ingredients.map((ing) => (
                      <option key={ing.id} value={ing.id}>
                        {ing.name} ({ing.unit})
                      </option>
                    ))}
                    <option value="__new__">＋ New ingredient…</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>
                    Qty to add{targetUnit(r) ? ` (${targetUnit(r)})` : ""}
                  </label>
                  <input
                    value={r.qty_to_add}
                    onChange={(e) => setRow(i, { qty_to_add: e.target.value })}
                    inputMode="decimal"
                    placeholder={r.qty || "—"}
                    className={inputCls}
                  />
                </div>
              </div>
              {(() => {
                const unit = targetUnit(r);
                const add = num(r.qty_to_add);
                const lineTotal = num(r.line_total) ?? (num(r.unit_price) != null && num(r.qty) != null ? num(r.unit_price)! * num(r.qty)! : null);
                const sug = r.qtyTouched ? null : suggestionFor(r);
                const mismatch = unit && !sug && !r.qtyTouched && unitsMismatch(r.unit || null, unit);
                if (!unit) return null;
                return (
                  <p className={`mt-1.5 text-xs ${mismatch ? "text-red-600" : "text-stone-500"}`}>
                    {mismatch
                      ? `Invoiced per ${r.unit}, counted in ${unit}: enter how many ${unit} this line adds.`
                      : sug
                        ? sug.how
                        : null}
                    {add != null && add > 0 && lineTotal != null && !mismatch && (
                      <span className="tnum ml-1 font-semibold text-stone-700">
                        → {formatUnitCost(lineTotal / add)}/{unit}
                      </span>
                    )}
                  </p>
                );
              })()}

              {r.isNew && (
                <div className="mt-2.5 grid grid-cols-3 gap-2.5 rounded-lg bg-stone-50 p-3">
                  <div className="col-span-3 sm:col-span-1">
                    <label className={labelCls}>New ingredient name</label>
                    <input value={r.new_name} onChange={(e) => setRow(i, { new_name: e.target.value })} className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Category</label>
                    <select value={r.new_category} onChange={(e) => setRow(i, { new_category: e.target.value })} className={inputCls}>
                      {Object.entries(CATEGORIES).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Unit</label>
                    <input value={r.new_unit} onChange={(e) => setRow(i, { new_unit: e.target.value })} className={inputCls} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-stone-100 pt-3 text-sm">
          <span className="text-stone-500">
            Lines <span className="tnum font-semibold text-stone-900">${linesSum.toFixed(2)}</span>
            {" + "}freight &amp; tax = <span className="tnum font-semibold text-stone-900">${computedTotal.toFixed(2)}</span>
          </span>
          {diff != null && (
            <span className={`tnum font-medium ${Math.abs(diff) < 0.02 ? "text-emerald-700" : "text-red-600"}`}>
              {Math.abs(diff) < 0.02 ? "✓ Matches the invoice total" : `Off by $${diff.toFixed(2)} vs the printed total`}
            </span>
          )}
        </div>
      </Card>

      {error && <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-sm text-red-700">{error}</p>}

      <div className="flex flex-col gap-2.5 sm:flex-row">
        <button
          onClick={() => save(true)}
          disabled={pending}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-copper-600 py-3.5 font-display text-xl font-semibold uppercase tracking-[0.14em] text-white transition hover:bg-copper-700 disabled:opacity-60"
        >
          <Check className="h-5 w-5" /> {pending ? "Posting…" : "Post to inventory"}
        </button>
        <button
          onClick={() => save(false)}
          disabled={pending}
          className="rounded-xl border border-stone-300 bg-white px-5 py-3 font-semibold text-stone-700 transition hover:border-copper-400 disabled:opacity-60"
        >
          Save draft
        </button>
        <button
          onClick={() =>
            startTransition(async () => {
              try {
                await deleteInvoice(invoice.id);
                router.push("/invoices");
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            })
          }
          disabled={pending}
          className="rounded-xl px-4 py-3 font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-60"
        >
          Delete
        </button>
      </div>
      <p className="text-center text-xs text-stone-400">
        Posting adds every line to inventory and updates each ingredient&apos;s average cost from these prices.
      </p>
    </div>
  );
}
