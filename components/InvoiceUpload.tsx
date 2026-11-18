"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBlankInvoice } from "@/lib/invoice-actions";
import { Card } from "@/components/ui";
import { Camera, FileUp, PenLine, Loader2 } from "lucide-react";

/** Upload a supplier invoice (photo or PDF) or start a blank manual entry. */
export default function InvoiceUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function onFile(file: File) {
    setBusy("Reading invoice…");
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/invoices/extract", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      router.push(`/invoices/${data.invoiceId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  }

  async function blank() {
    setBusy("Starting…");
    setError("");
    try {
      const id = await createBlankInvoice();
      router.push(`/invoices/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy("");
    }
  }

  return (
    <Card title="Add an invoice">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <button
          onClick={() => inputRef.current?.click()}
          disabled={!!busy}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-copper-600 px-4 py-3 font-semibold text-white transition hover:bg-copper-700 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Camera className="h-4.5 w-4.5" />}
          {busy || "Take photo / upload invoice"}
        </button>
        <button
          onClick={blank}
          disabled={!!busy}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-3 font-semibold text-stone-700 transition hover:border-copper-400 hover:text-copper-700 disabled:opacity-60"
        >
          <PenLine className="h-4.5 w-4.5" /> Enter manually
        </button>
      </div>
      <p className="mt-2.5 flex items-start gap-1.5 text-xs text-stone-400">
        <FileUp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Snap a picture of a paper invoice or upload the supplier's PDF. The app reads the
        line items and prices — you review everything before it touches inventory.
      </p>
      {error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </Card>
  );
}
