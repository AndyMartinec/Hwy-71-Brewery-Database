import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AUTH_DISABLED } from "@/lib/config";
import { extractFermentationSheet, matchBatchId } from "@/lib/fermentation";

export const maxDuration = 60;

/**
 * Accepts a fermentation sheet (photo or PDF), stores the original, reads it
 * with the vision model, and creates a DRAFT scan with one row per reading,
 * each matched to a batch when possible. Nothing touches the fermentation
 * log until the draft is reviewed and posted.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user && !AUTH_DISABLED) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "File is over 20 MB" }, { status: 400 });
  }
  const okTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
  if (!okTypes.includes(file.type)) {
    return NextResponse.json(
      { error: "Upload a photo (JPG/PNG) or a PDF of the fermentation sheet." },
      { status: 400 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("fermentation-sheets")
    .upload(path, bytes, { contentType: file.type });
  if (upErr) {
    return NextResponse.json(
      { error: `Could not store the file: ${upErr.message} (has the fermentation-scans SQL been run?)` },
      { status: 500 }
    );
  }

  let extracted = null;
  try {
    extracted = await extractFermentationSheet(bytes, file.type, safeName);
  } catch (e) {
    // Keep the draft — rows can be entered manually on the review screen.
    console.error("fermentation extraction:", e);
  }

  const { data: scan, error: scanErr } = await supabase
    .from("fermentation_scans")
    .insert({ file_path: path, file_name: file.name })
    .select("id")
    .single();
  if (scanErr) {
    return NextResponse.json({ error: scanErr.message }, { status: 500 });
  }

  if (extracted?.lines.length) {
    // A new chart is always for the most recent batch of that beer: only
    // Brewing/Fermenting batches are candidates, and among name matches the
    // highest batch number wins. Completed/conditioning never match.
    const { data: batches } = await supabase
      .from("batches")
      .select("id,batch_number,recipe_name")
      .in("status", ["Brewing", "Fermenting"])
      .order("updated_at", { ascending: false })
      .limit(200);
    const rows = extracted.lines.map((l) => ({
      scan_id: scan.id,
      batch_id: matchBatchId(l.batch_label, batches ?? []),
      batch_label: l.batch_label,
      taken_at: l.date,
      plato: l.plato,
      temp_f: l.temp_f,
      action: l.action,
    }));
    const { error: linesErr } = await supabase.from("fermentation_scan_lines").insert(rows);
    if (linesErr) {
      return NextResponse.json({ error: linesErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ scanId: scan.id, extracted: !!extracted });
}
