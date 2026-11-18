"use client";

import { useState, useTransition } from "react";
import { adjustFinishedGoods, type FgReason } from "@/lib/actions";
import { Card, inputCls, labelCls, primaryBtn } from "@/components/ui";

const REASONS: { value: FgReason; label: string }[] = [
  { value: "sold", label: "Sold" },
  { value: "packaged", label: "Packaged" },
  { value: "adjustment", label: "Adjust" },
  { value: "destroyed", label: "Destroyed" },
  { value: "returned", label: "Returned" },
];

export interface MovementBatch {
  id: string;
  recipe_name: string;
  batch_number: string | null;
}

/** Log keg/case movements: sales, packaging, adjustments, dumps. */
export default function KegMovementForm({
  beers,
  batches = [],
}: {
  beers: string[];
  batches?: MovementBatch[];
}) {
  const [beer, setBeer] = useState(beers[0] ?? "");
  const [packageType, setPackageType] = useState("Half-barrel keg");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<FgReason>("sold");
  const [channel, setChannel] = useState("on_premise");
  const [batchId, setBatchId] = useState("");
  const [approvalRef, setApprovalRef] = useState("");
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" })
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });
  // Batches of the beer being moved, most recent first (batch_number desc).
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
    if (reason === "destroyed" && !approvalRef.trim()) {
      setError("Destroyed beer needs its TABC pre-approval reference — without it, the volume stays taxable.");
      return;
    }
    // Out reasons are negative; packaged/returned are positive.
    const signed = reason === "packaged" || reason === "returned" ? n : -n;
    startTransition(async () => {
      try {
        await adjustFinishedGoods(
          beer.trim(),
          packageType,
          signed,
          reason,
          reason === "sold"
            ? (channel as "retail" | "on_premise" | "off_premise" | "distributor")
            : undefined,
          note || undefined,
          {
            batchId: reason === "sold" ? batchId || undefined : undefined,
            movedAt: date || undefined,
            approvalRef: reason === "destroyed" ? approvalRef.trim() : undefined,
          }
        );
        setQty("");
        setNote("");
        setApprovalRef("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <Card title="Log movement">
      <form onSubmit={submit} className="-my-1">
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setReason(r.value)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${
                reason === r.value
                  ? "bg-ink-900 text-white ring-ink-900"
                  : "bg-white text-stone-600 ring-stone-300 hover:ring-stone-400"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label className={labelCls}>Beer</label>
          <input value={beer} onChange={(e) => setBeer(e.target.value)} list="beer-names" placeholder="Beer name" className={inputCls} />
          <datalist id="beer-names">
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

        {reason === "sold" && (
          <>
            <div className="mt-3">
              <label className={labelCls}>Channel</label>
              <select value={channel} onChange={(e) => setChannel(e.target.value)} className={inputCls}>
                <option value="on_premise">On-premise (taproom)</option>
                <option value="off_premise">Off-premise (to-go)</option>
                <option value="retail">Retail (accounts)</option>
                <option value="distributor">Distributor</option>
              </select>
            </div>
            {beerBatches.length > 0 && (
              <div className="mt-3">
                <label className={labelCls}>Batch (optional)</label>
                <select value={batchId} onChange={(e) => setBatchId(e.target.value)} className={inputCls}>
                  <option value="">Unknown / mixed — use beer-average cost</option>
                  {beerBatches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batch_number ? `Batch #${b.batch_number}` : b.recipe_name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}

        {reason === "destroyed" && (
          <div className="mt-3">
            <label className={labelCls}>TABC approval ref</label>
            <input
              value={approvalRef}
              onChange={(e) => setApprovalRef(e.target.value)}
              placeholder="Pre-approval reference"
              className={inputCls}
            />
            <p className="mt-1 text-xs text-stone-500">
              Destruction is only tax-exempt with TABC pre-approval.
            </p>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Date</label>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Note</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className={inputCls} />
          </div>
        </div>
        <p className="mt-2 text-xs text-stone-500">
          The date is the tax date — a late entry still lands in the month it
          actually happened.
        </p>

        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button disabled={pending} className={`${primaryBtn} mt-4 w-full`}>
          {pending ? "Saving…" : "Save movement"}
        </button>
      </form>
    </Card>
  );
}
