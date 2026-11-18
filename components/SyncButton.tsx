"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";

/** Manual "Sync from Brewfather" button. */
export default function SyncButton() {
  const [state, setState] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function sync() {
    setState("syncing");
    setMsg("");
    try {
      const res = await fetch("/api/brewfather/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Sync failed");
      setState("done");
      setMsg(
        `Synced ${data.batches?.upserted ?? 0} batches, ${data.recipes?.upserted ?? 0} recipes, ${data.catalog?.created ?? 0} new ingredients from Brewfather.` +
        (data.autoDeduct?.batches
          ? ` Auto-deducted ${data.autoDeduct.batches} new batch${data.autoDeduct.batches > 1 ? "es" : ""} from inventory` +
            (data.autoDeduct.substitutions ? ` (${data.autoDeduct.substitutions} substitutions)` : "") +
            (data.autoDeduct.shortages ? ` — ${data.autoDeduct.shortages} shortage${data.autoDeduct.shortages > 1 ? "s" : ""}, check the batch page` : "") +
            "."
          : "")
      );
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setState("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <button
        onClick={sync}
        disabled={state === "syncing"}
        className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:border-copper-400 hover:text-copper-700 disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${state === "syncing" ? "animate-spin" : ""}`} />
        {state === "syncing" ? "Syncing…" : "Sync from Brewfather"}
      </button>
      {msg && (
        <p className={`mt-1.5 text-sm ${state === "error" ? "text-red-600" : "text-emerald-700"}`}>{msg}</p>
      )}
    </div>
  );
}
