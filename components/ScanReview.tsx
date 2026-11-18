"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, primaryBtn, inputCls, labelCls } from "@/components/ui";
import { saveFermentationScanLines, postFermentationScan } from "@/lib/actions";
import { Plus, Trash2 } from "lucide-react";
import DeleteScanButton from "@/components/DeleteScanButton";
import type { StreamPushResult } from "@/lib/brewfather-stream";

export interface ReviewRow {
  id?: string;
  batch_id: string | null;
  batch_label: string | null;
  taken_at: string | null;
  plato: number | null;
  temp_f: number | null;
  action: string | null;
}

export interface ReviewBatch {
  id: string;
  batch_number: string | null;
  recipe_name: string;
  status: string;
}

/** °Plato -> SG (same formula as the server; shown as a preview only). */
function platoToSG(plato: number): number {
  return Math.round((1 + plato / (258.6 - (plato / 258.2) * 227.1)) * 10000) / 10000;
}

const blankRow = (): ReviewRow => ({
  batch_id: null,
  batch_label: null,
  taken_at: null,
  plato: null,
  temp_f: null,
  action: null,
});

export default function ScanReview({
  scanId,
  status,
  initialLines,
  batches,
  fixedBatchId = null,
}: {
  scanId: string;
  status: string;
  initialLines: ReviewRow[];
  batches: ReviewBatch[];
  /** When set, rows post to this batch and the batch selects are disabled. */
  fixedBatchId?: string | null;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<ReviewRow[]>(
    initialLines.length ? initialLines : [blankRow()]
  );
  const [busy, setBusy] = useState<"save" | "post" | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [bfResults, setBfResults] = useState<StreamPushResult[]>([]);
  const [postedHere, setLocked] = useState(false);
  const locked = status !== "draft" || postedHere;

  function set(i: number, patch: Partial<ReviewRow>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function save() {
    setBusy("save");
    setError("");
    setDone("");
    try {
      await saveFermentationScanLines(scanId, rows);
      setDone("Draft saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(null);
    }
  }

  async function post() {
    setBusy("post");
    setError("");
    setDone("");
    try {
      await saveFermentationScanLines(scanId, rows);
      const r = await postFermentationScan(scanId);
      setDone(
        `Posted ${r.posted} reading${r.posted === 1 ? "" : "s"}` +
          (r.skipped ? ` (${r.skipped} already in the log, skipped)` : "") +
          "."
      );
      // Stay on the page to show what reached Brewfather; otherwise go back.
      if (r.brewfather.length > 0) {
        setBfResults(r.brewfather);
        setBusy(null);
        setLocked(true);
      } else {
        router.push("/fermentation");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Post failed.");
      setBusy(null);
    }
  }

  return (
    <Card
      title="Readings"
      action={
        !locked && (
          <span className="inline-flex items-center gap-3">
            <DeleteScanButton scanId={scanId} redirect />
            <button
              onClick={() => setRows((rs) => [...rs, blankRow()])}
              className="inline-flex items-center gap-1 text-xs font-semibold text-copper-700 hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> Add row
            </button>
          </span>
        )
      }
    >
      <div className="-mx-5 -my-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
              <th className="px-5 py-2.5 font-semibold">Batch</th>
              <th className="px-3 py-2.5 font-semibold">Date</th>
              <th className="px-3 py-2.5 text-right font-semibold">Gravity (°P)</th>
              <th className="px-3 py-2.5 text-right font-semibold">°F</th>
              <th className="px-3 py-2.5 font-semibold">Action</th>
              {!locked && <th className="px-5 py-2.5" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r, i) => (
              <tr key={r.id ?? `new-${i}`} className={r.batch_id ? "" : "bg-amber-50/50"}>
                <td className="px-5 py-2.5">
                  <select
                    disabled={locked || !!fixedBatchId}
                    value={r.batch_id ?? ""}
                    onChange={(e) => set(i, { batch_id: e.target.value || null })}
                    className={`${inputCls} min-w-44 ${r.batch_id ? "" : "!border-amber-400"}`}
                    title={r.batch_label ?? ""}
                  >
                    <option value="">Select batch…</option>
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.batch_number ? `#${b.batch_number} — ` : ""}
                        {b.recipe_name} ({b.status})
                      </option>
                    ))}
                  </select>
                  {r.batch_label && !r.batch_id && !fixedBatchId && (
                    <p className="mt-0.5 text-xs text-amber-700">Sheet says: “{r.batch_label}”</p>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <input
                    type="date"
                    disabled={locked}
                    value={r.taken_at ?? ""}
                    onChange={(e) => set(i, { taken_at: e.target.value || null })}
                    className={inputCls}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <input
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    disabled={locked}
                    value={r.plato ?? ""}
                    onChange={(e) =>
                      set(i, { plato: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className={`${inputCls} tnum w-20 text-right`}
                  />
                  <div className="tnum mt-0.5 text-right text-[10px] text-stone-400">
                    {r.plato != null ? `${platoToSG(r.plato).toFixed(3)} SG` : ""}
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <input
                    type="number"
                    step="0.1"
                    inputMode="decimal"
                    disabled={locked}
                    value={r.temp_f ?? ""}
                    onChange={(e) =>
                      set(i, { temp_f: e.target.value === "" ? null : Number(e.target.value) })
                    }
                    className={`${inputCls} tnum w-20 text-right`}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <input
                    type="text"
                    disabled={locked}
                    value={r.action ?? ""}
                    onChange={(e) => set(i, { action: e.target.value || null })}
                    placeholder="e.g. Dry-hopped with 1 lb Azacca"
                    className={`${inputCls} min-w-44`}
                  />
                </td>
                {!locked && (
                  <td className="px-5 py-2.5 text-right">
                    <button
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                      className="text-stone-400 transition hover:text-red-600"
                      title="Remove row"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {done && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>
      )}
      {bfResults.length > 0 && (
        <div className="mt-3 rounded-lg border border-stone-200 px-3 py-2.5 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Brewfather</p>
          <ul className="mt-1 space-y-1">
            {bfResults.map((b, i) => (
              <li key={i} className={b.status === "sent" ? "text-green-800" : b.status === "failed" ? "text-red-700" : "text-amber-800"}>
                <span className="font-semibold">
                  {b.tank ? `Tank ${b.tank}` : b.batch}
                  {b.status === "sent" ? " ✓" : b.status === "failed" ? " ✗" : " –"}
                </span>{" "}
                {b.detail}
              </li>
            ))}
          </ul>
          <button onClick={() => router.push("/fermentation")} className="mt-2 text-xs font-semibold text-copper-700 hover:underline">
            Back to the tank farm →
          </button>
        </div>
      )}

      {!locked && (
        <div className="mt-4 flex gap-2">
          <button disabled={busy !== null} onClick={save} className={`${primaryBtn} !bg-ink-900 hover:!bg-ink-700`}>
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
          <button disabled={busy !== null} onClick={post} className={primaryBtn}>
            {busy === "post" ? "Posting…" : "Post readings"}
          </button>
        </div>
      )}
      <p className="mt-3 text-xs text-stone-400">
        Posting converts °Plato to specific gravity and writes each row to
        that batch&apos;s fermentation log. Rows already in the log are
        skipped, so re-scanning a sheet is safe. Highlighted rows still need
        a batch picked.
      </p>
    </Card>
  );
}
