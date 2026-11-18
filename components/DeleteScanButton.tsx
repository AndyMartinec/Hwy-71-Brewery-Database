"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteFermentationScan } from "@/lib/actions";
import { Trash2 } from "lucide-react";

/** Delete a draft scan after confirmation. Posted scans are never offered. */
export default function DeleteScanButton({
  scanId,
  redirect = false,
}: {
  scanId: string;
  redirect?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (
      !window.confirm(
        "Delete this draft scan? Its rows will be discarded. Readings already posted to the log are never affected."
      )
    )
      return;
    setBusy(true);
    try {
      await deleteFermentationScan(scanId);
      if (redirect) router.push("/fermentation");
      else router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed.");
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="Delete draft scan"
      className="shrink-0 p-2 text-stone-300 transition hover:text-red-600 disabled:opacity-50"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  );
}
