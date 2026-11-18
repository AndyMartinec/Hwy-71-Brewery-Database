"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { AUTH_DISABLED } from "@/lib/config";
import { adjustIngredient, createIngredient } from "@/lib/actions";
import { normalizeName } from "@/lib/invoices";
import { canonicalUnit, isKnownUnit } from "@/lib/units";

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user && !AUTH_DISABLED) throw new Error("Sign in required.");
  return { supabase, user };
}

/** Start a blank invoice (manual entry path — no file). Returns the id. */
export async function createBlankInvoice(): Promise<string> {
  const { supabase, user } = await authed();
  const { data, error } = await supabase
    .from("invoices")
    .insert({ created_by: user?.id ?? null })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/invoices");
  return data.id;
}

export async function updateInvoiceHeader(
  invoiceId: string,
  fields: {
    supplier?: string | null;
    invoice_number?: string | null;
    invoice_date?: string | null;
    freight?: number;
    tax?: number;
    total?: number | null;
  }
) {
  const { supabase } = await authed();
  const { error } = await supabase.from("invoices").update(fields).eq("id", invoiceId);
  if (error) throw new Error(error.message);
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function updateInvoiceLine(
  lineId: string,
  fields: {
    raw_name?: string;
    qty?: number | null;
    unit?: string | null;
    unit_price?: number | null;
    line_total?: number | null;
    ingredient_id?: string | null;
    qty_to_add?: number | null;
    new_name?: string | null;
    new_category?: string | null;
    new_unit?: string | null;
  }
) {
  const { supabase } = await authed();
  const { error } = await supabase.from("invoice_lines").update(fields).eq("id", lineId);
  if (error) throw new Error(error.message);
}

export async function addInvoiceLine(invoiceId: string): Promise<string> {
  const { supabase } = await authed();
  const { data, error } = await supabase
    .from("invoice_lines")
    .insert({ invoice_id: invoiceId, raw_name: "" })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(`/invoices/${invoiceId}`);
  return data.id;
}

export async function removeInvoiceLine(lineId: string, invoiceId: string) {
  const { supabase } = await authed();
  const { error } = await supabase.from("invoice_lines").delete().eq("id", lineId);
  if (error) throw new Error(error.message);
  revalidatePath(`/invoices/${invoiceId}`);
}

export async function deleteInvoice(invoiceId: string) {
  const { supabase } = await authed();
  const { data: inv } = await supabase
    .from("invoices")
    .select("file_path,status")
    .eq("id", invoiceId)
    .single();
  if (inv?.status === "posted") throw new Error("Posted invoices can't be deleted.");
  if (inv?.file_path) {
    await supabase.storage.from("invoices").remove([inv.file_path]);
  }
  const { error } = await supabase.from("invoices").delete().eq("id", invoiceId);
  if (error) throw new Error(error.message);
  revalidatePath("/invoices");
}

/**
 * Post a reviewed invoice: every line becomes a purchase movement (updating
 * the ingredient's weighted-average cost), new ingredients are created,
 * and supplier→item matches are learned for next time.
 */
export async function postInvoice(invoiceId: string) {
  const { supabase } = await authed();
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();
  if (invErr || !invoice) throw new Error("Invoice not found.");
  if (invoice.status === "posted") throw new Error("This invoice is already posted.");

  const { data: lines } = await supabase
    .from("invoice_lines")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("created_at");
  if (!lines?.length) throw new Error("Add at least one line before posting.");

  const noteParts = [
    invoice.supplier,
    invoice.invoice_number ? `#${invoice.invoice_number}` : null,
  ].filter(Boolean);
  const note = `Invoice ${noteParts.join(" ")}`.trim();

  for (const line of lines) {
    const qtyToAdd = Number(line.qty_to_add ?? line.qty ?? 0);
    if (!(qtyToAdd > 0)) {
      throw new Error(`Line "${line.raw_name || "(blank)"}" has no quantity to add.`);
    }
    let ingredientId: string | null = line.ingredient_id;
    if (!ingredientId) {
      if (!line.new_name?.trim()) {
        throw new Error(
          `Line "${line.raw_name || "(blank)"}" isn't matched to an ingredient. Match it or mark it as a new ingredient.`
        );
      }
      ingredientId = await createIngredient({
        name: line.new_name.trim(),
        category: line.new_category || "other",
        supplier: invoice.supplier || undefined,
        unit: line.new_unit || "lb",
      });
      await supabase
        .from("invoice_lines")
        .update({ ingredient_id: ingredientId })
        .eq("id", line.id);
    }

    // Cost per ingredient-unit from the line total (falls back to unit price).
    const unitCost =
      line.line_total != null
        ? Number(line.line_total) / qtyToAdd
        : line.unit_price != null
          ? Number(line.unit_price)
          : null;

    await adjustIngredient(ingredientId, qtyToAdd, "purchase", note, undefined, unitCost);

    // Remember the pack size ("bag" = 55 lb) on the ingredient's product
    // details, so the next invoice and the order planner can convert.
    // Best-effort: skipped quietly if product-details.sql hasn't run.
    const printed = canonicalUnit(line.unit);
    const printedQty = Number(line.qty ?? 0);
    if (printed && printedQty > 0 && (!isKnownUnit(printed) || printed === "each")) {
      const { data: ing } = await supabase
        .from("ingredients")
        .select("unit")
        .eq("id", ingredientId)
        .single();
      if (ing && canonicalUnit(ing.unit) !== "each") {
        const { error: packErr } = await supabase
          .from("ingredients")
          .update({
            pack_size: Math.round((qtyToAdd / printedQty) * 1000) / 1000,
            pack_unit: ing.unit,
            pack_label: line.unit,
          })
          .eq("id", ingredientId);
        if (packErr) console.warn("pack size not saved:", packErr.message);
      }
    }

    if (invoice.supplier && line.raw_name) {
      await supabase.from("supplier_item_matches").upsert(
        {
          supplier: invoice.supplier.trim(),
          raw_name_normalized: normalizeName(line.raw_name),
          ingredient_id: ingredientId,
        },
        { onConflict: "supplier,raw_name_normalized" }
      );
    }
  }

  const { error } = await supabase
    .from("invoices")
    .update({ status: "posted", posted_at: new Date().toISOString() })
    .eq("id", invoiceId);
  if (error) throw new Error(error.message);

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/inventory");
  revalidatePath("/");
}
