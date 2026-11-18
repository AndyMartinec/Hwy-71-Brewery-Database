"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, primaryBtn } from "@/components/ui";
import { Camera, UploadCloud } from "lucide-react";

/** Upload a fermentation sheet photo/PDF and jump to the review screen.
 *  presetBatchId locks the review to one batch (e.g. a tank's batch). */
export default function ScanUpload({
  presetBatchId,
  title = "Scan a fermentation sheet",
}: {
  presetBatchId?: string;
  title?: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file: File | undefined, useCamera: boolean) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/fermentation/extract", {
        method: "POST",
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed.");
      router.push(
        `/fermentation/${json.scanId}${presetBatchId ? `?batch=${presetBatchId}` : ""}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setBusy(false);
    }
  }

  return (
    <Card title={title}>
      <input
        ref={fileRef}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        data-camera="false"
        onChange={(e) => {
          const useCamera = fileRef.current?.dataset.camera === "true";
          handleFile(e.target.files?.[0], useCamera);
          e.target.value = "";
        }}
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          disabled={busy}
          className={primaryBtn}
          onClick={() => {
            if (fileRef.current) {
              fileRef.current.dataset.camera = "true";
              fileRef.current.setAttribute("capture", "environment");
              fileRef.current.click();
            }
          }}
        >
          <Camera className="h-4 w-4" /> {busy ? "Reading…" : "Take photo"}
        </button>
        <button
          disabled={busy}
          className={`${primaryBtn} !bg-ink-900 hover:!bg-ink-700`}
          onClick={() => {
            if (fileRef.current) {
              fileRef.current.dataset.camera = "false";
              fileRef.current.removeAttribute("capture");
              fileRef.current.click();
            }
          }}
        >
          <UploadCloud className="h-4 w-4" /> {busy ? "Reading…" : "Upload file"}
        </button>
      </div>
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {!error && (
        <p className="mt-3 text-xs text-stone-400">
          The sheet is read automatically; you&apos;ll review every row before
          anything is posted. Nothing is final until you hit Post.
        </p>
      )}
    </Card>
  );
}
