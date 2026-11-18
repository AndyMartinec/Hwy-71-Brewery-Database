import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AUTH_DISABLED } from "@/lib/config";
import { extractInvoice, normalizeName, suggestIngredientId } from "@/lib/invoices";

export const maxDuration = 60;

/**
 * Accepts an invoice file (photo or PDF), stores the original, reads it with
 * the vision model, and creates a DRAFT invoice with matched lines for the
 * review screen. Nothing touches inventory until the draft is posted.
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
      { error: "Upload a photo (JPG/PNG) or a PDF of the invoice." },
      { status: 400 }
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("invoices")
    .upload(path, bytes, { contentType: file.type });
  if (upErr) {
    return NextResponse.json(
      { error: `Could not store the file: ${upErr.message} (has the Phase 1 SQL been run?)` },
      { status: 500 }
    );
  }

  let extracted = null;
  try {
    extracted = await extractInvoice(bytes, file.type, safeName);
  } catch (e) {
    // Keep the draft — the user can fill it in manually on the review screen.
    console.error("invoice extraction:", e);
  }

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert({
      supplier: extracted?.supplier ?? null,
      invoice_number: extracted?.invoice_number ?? null,
      invoice_date: extracted?.invoice_date ?? null,
      freight: extracted?.freight ?? 0,
      tax: extracted?.tax ?? 0,
      total: extracted?.total ?? null,
      file_path: path,
      file_name: file.name,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (invErr) {
    return NextResponse.json({ error: invErr.message }, { status: 500 });
  }

  if (extracted?.lines.length) {
    const [{ data: ingredients }, { data: learned }] = await Promise.all([
      supabase.from("ingredients").select("id,name"),
      supabase.from("supplier_item_matches").select("supplier,raw_name_normalized,ingredient_id"),
    ]);
    const learnedMap = new Map(
      (learned ?? []).map((m) => [`${m.supplier}||${m.raw_name_normalized}`, m.ingredient_id])
    );
    const supplierKey = (extracted.supplier ?? "").trim();

    const rows = extracted.lines.map((l) => {
      const learnedId = learnedMap.get(`${supplierKey}||${normalizeName(l.raw_name)}`);
      const ingredientId =
        learnedId ?? suggestIngredientId(l.raw_name, ingredients ?? []);
      return {
        invoice_id: invoice.id,
        raw_name: l.raw_name,
        qty: l.qty,
        unit: l.unit,
        unit_price: l.unit_price,
        line_total:
          l.line_total ?? (l.qty != null && l.unit_price != null ? l.qty * l.unit_price : null),
        ingredient_id: ingredientId,
        qty_to_add: l.qty,
      };
    });
    const { error: linesErr } = await supabase.from("invoice_lines").insert(rows);
    if (linesErr) {
      return NextResponse.json({ error: linesErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ invoiceId: invoice.id, extracted: !!extracted });
}
