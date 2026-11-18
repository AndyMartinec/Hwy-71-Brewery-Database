"use client";

import { useState, useTransition } from "react";
import {
  updateBatchStatus,
  addFermentationReading,
  adjustIngredient,
  logPackaging,
} from "@/lib/actions";
import VoiceDictation from "@/components/VoiceDictation";
import { Card, inputCls, labelCls, primaryBtn } from "@/components/ui";
import { CATEGORIES } from "@/lib/categories";

const STATUSES = ["Planning", "Brewing", "Fermenting", "Conditioning", "Completed", "Archived"];

function useSubmit() {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return { error, setError, pending, startTransition };
}

export function StatusChanger({ batchId, current }: { batchId: string; current: string }) {
  const { error, setError, pending, startTransition } = useSubmit();
  return (
    <div>
      <p className={labelCls}>Status</p>
      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button
            key={s}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError("");
                try {
                  await updateBatchStatus(batchId, s);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              })
            }
            className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${
              current === s
                ? "bg-ink-900 text-white ring-ink-900"
                : "bg-white text-stone-600 ring-stone-300 hover:ring-stone-400"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function ReadingForm({ batchId }: { batchId: string }) {
  const { error, setError, pending, startTransition } = useSubmit();
  const [gravity, setGravity] = useState("");
  const [temp, setTemp] = useState("");
  const [note, setNote] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const g = parseFloat(gravity);
    startTransition(async () => {
      try {
        await addFermentationReading(batchId, {
          // Accept "1.052" or "1052" style entries.
          gravity: gravity ? (g >= 2 ? g / 1000 : g) : null,
          temp_f: temp ? parseFloat(temp) : null,
          note: note || undefined,
        });
        setGravity("");
        setTemp("");
        setNote("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card title="Add reading">
      <form onSubmit={submit} className="-my-1">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Gravity</label>
            <input value={gravity} onChange={(e) => setGravity(e.target.value)} inputMode="decimal" placeholder="1.052" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Temp °F</label>
            <input value={temp} onChange={(e) => setTemp(e.target.value)} inputMode="decimal" placeholder="68" className={inputCls} />
          </div>
        </div>
        <div className="mt-3">
          <label className={labelCls}>Note</label>
          <div className="flex items-center gap-2">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className={inputCls} />
            <VoiceDictation onText={(t) => setNote((n) => (n ? n + " " + t : t))} />
          </div>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={pending} className={`${primaryBtn} mt-4 w-full`}>
          {pending ? "Saving…" : "Save reading"}
        </button>
      </form>
    </Card>
  );
}

export function IngredientUseForm({
  batchId,
  ingredients,
}: {
  batchId: string;
  ingredients: { id: string; name: string; category: string; unit: string }[];
}) {
  const { error, setError, pending, startTransition } = useSubmit();
  const [ingredientId, setIngredientId] = useState(ingredients[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const selected = ingredients.find((i) => i.id === ingredientId);

  const groups = new Map<string, typeof ingredients>();
  for (const i of ingredients) {
    if (!groups.has(i.category)) groups.set(i.category, []);
    groups.get(i.category)!.push(i);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const n = parseFloat(qty);
    if (!ingredientId || !n || n <= 0) {
      setError("Pick an ingredient and enter the amount used.");
      return;
    }
    startTransition(async () => {
      try {
        await adjustIngredient(ingredientId, -n, "brew_usage", undefined, batchId);
        setQty("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card title="Ingredient used">
      <form onSubmit={submit} className="-my-1">
        <div>
          <label className={labelCls}>Ingredient — grain, hops, yeast, anything</label>
          <select value={ingredientId} onChange={(e) => setIngredientId(e.target.value)} className={inputCls}>
            {[...groups.entries()].map(([cat, items]) => (
              <optgroup key={cat} label={CATEGORIES[cat] ?? cat}>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="mt-3">
          <label className={labelCls}>Amount used{selected ? ` (${selected.unit})` : ""}</label>
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="0" className={inputCls} />
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={pending} className={`${primaryBtn} mt-4 w-full`}>
          {pending ? "Saving…" : "Deduct from inventory"}
        </button>
      </form>
    </Card>
  );
}

export function PackagingForm({
  batchId,
  defaultBeer,
}: {
  batchId: string;
  defaultBeer: string;
}) {
  const { error, setError, pending, startTransition } = useSubmit();
  const [beer, setBeer] = useState(defaultBeer);
  const [packageType, setPackageType] = useState("Half-barrel keg");
  const [qty, setQty] = useState("");
  const [gallons, setGallons] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const n = parseInt(qty, 10);
    if (!beer.trim() || !n || n <= 0) {
      setError("Enter a beer name and quantity.");
      return;
    }
    startTransition(async () => {
      try {
        await logPackaging({
          batch_id: batchId,
          beer_name: beer.trim(),
          package_type: packageType,
          qty: n,
          gallons: gallons ? parseFloat(gallons) : null,
        });
        setQty("");
        setGallons("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card title="Package this batch">
      <form onSubmit={submit} className="-my-1">
        <div>
          <label className={labelCls}>Beer</label>
          <input value={beer} onChange={(e) => setBeer(e.target.value)} placeholder="Beer name" className={inputCls} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <label className={labelCls}>Package</label>
            <select value={packageType} onChange={(e) => setPackageType(e.target.value)} className={inputCls}>
              <option>Half-barrel keg</option>
              <option>Sixth-barrel keg</option>
              <option>Case 12oz</option>
              <option>Case 16oz</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Qty</label>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" placeholder="6" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Gallons</label>
            <input value={gallons} onChange={(e) => setGallons(e.target.value)} inputMode="decimal" placeholder="93" className={inputCls} />
          </div>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={pending} className={`${primaryBtn} mt-4 w-full`}>
          {pending ? "Saving…" : "Record packaging"}
        </button>
      </form>
    </Card>
  );
}
