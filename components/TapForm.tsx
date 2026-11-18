"use client";

import { useState, useTransition } from "react";
import { logTapEvent } from "@/lib/actions";
import { Card, inputCls, labelCls, primaryBtn } from "@/components/ui";
import type { MovementBatch } from "@/components/KegMovementForm";

/** Log a keg going ON TAP. Stock-neutral: tapping does not remove the keg
 *  from finished inventory — the later "sold" movement does that. This is
 *  what the Reports page uses for poured volume (tapped x package size). */
export default function TapForm({
  beers,
  batches = [],
}: {
  beers: string[];
  batches?: MovementBatch[];
}) {
  const [beer, setBeer] = useState(beers[0] ?? "");
  const [packageType, setPackageType] = useState("Half-barrel keg");
  const [qty, setQty] = useState("");
  const [batchId, setBatchId] = useState("");
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" })
  );
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });
  const beerBatches = batches
    .filter((b) => b.recipe_name === beer)
    .sort((a, b) => String(b.batch_number ?? "").localeCompare(String(a.batch_number ?? "")));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const n = parseInt(qty, 10);
    if (!beer.trim() || !n || n <= 0) {
      setError("Enter a beer and a quantity.");
      return;
    }
    startTransition(async () => {
      try {
        await logTapEvent({
          beer_name: beer.trim(),
          package_type: packageType,
          qty: n,
          batch_id: batchId || undefined,
          tapped_at: date || undefined,
        });
        setQty("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card title="Log a tap">
      <form onSubmit={submit} className="-my-1">
        <div>
          <label className={labelCls}>Beer</label>
          <input
            value={beer}
            onChange={(e) => setBeer(e.target.value)}
            list="tap-beer-names"
            placeholder="Beer name"
            className={inputCls}
          />
          <datalist id="tap-beer-names">
            {beers.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Package</label>
            <select value={packageType} onChange={(e) => setPackageType(e.target.value)} className={inputCls}>
              <option>Half-barrel keg</option>
              <option>Sixth-barrel keg</option>
              <option>Case 12oz</option>
              <option>Case 16oz</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Quantity</label>
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="numeric" placeholder="1" className={inputCls} />
          </div>
        </div>
        {beerBatches.length > 0 && (
          <div className="mt-3">
            <label className={labelCls}>Batch (optional)</label>
            <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={inputCls}>
              <option value="">Unknown / mixed</option>
              {beerBatches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batch_number ? `Batch #${b.batch_number}` : b.recipe_name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="mt-3">
          <label className={labelCls}>Date tapped</label>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className={inputCls}
          />
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={pending} className={`${primaryBtn} mt-4 w-full`}>
          {pending ? "Saving…" : "Log tap"}
        </button>
        <p className="mt-2 text-xs text-stone-500">
          Tapping doesn&apos;t change kegs on hand — it records what went on
          tap, so poured volume can be compared to sold volume.
        </p>
      </form>
    </Card>
  );
}
