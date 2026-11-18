"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setBatchStatus, pushBatchUpdate, LITERS_PER_BARREL } from "@/lib/brewfather";
import { redirect } from "next/navigation";
import type { VoiceAction } from "@/app/api/voice/command/route";
import { AUTH_DISABLED } from "@/lib/config";
import { pushLatestReadings, type StreamPushResult } from "@/lib/brewfather-stream";

async function authed() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user && !AUTH_DISABLED) throw new Error("Sign in required.");
  return { supabase, user };
}

export type TxnReason = "opening" | "purchase" | "brew_usage" | "adjustment" | "spoilage";

/** Record a raw-material movement. qtyChange: negative = used, positive = received.
 *  On a purchase with a unitCost, the ingredient's weighted-average cost updates. */
export async function adjustIngredient(
  ingredientId: string,
  qtyChange: number,
  reason: TxnReason,
  note?: string,
  batchId?: string,
  unitCost?: number | null
) {
  const { supabase, user } = await authed();

  // Capture pre-movement stock for the weighted-average cost update.
  let before: { on_hand: number; cost_per_unit: number | null } | null = null;
  if (reason === "purchase" && qtyChange > 0 && unitCost != null) {
    const { data } = await supabase
      .from("ingredient_stock")
      .select("on_hand,cost_per_unit")
      .eq("id", ingredientId)
      .single();
    if (data) before = { on_hand: Number(data.on_hand), cost_per_unit: data.cost_per_unit };
  }

  // Stamp the ingredient's own unit on the ledger row (the column defaults
  // to "lb", which mislabels hops in oz, yeast in pkg, salts in g).
  const { data: ing } = await supabase
    .from("ingredients")
    .select("unit")
    .eq("id", ingredientId)
    .single();

  const { error } = await supabase.from("inventory_transactions").insert({
    ingredient_id: ingredientId,
    qty_change: qtyChange,
    unit: ing?.unit ?? "lb",
    reason,
    note: note || null,
    batch_id: batchId || null,
    unit_cost: unitCost ?? null,
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);

  if (before && unitCost != null) {
    const newAvg =
      before.on_hand > 0 && before.cost_per_unit != null
        ? (before.on_hand * before.cost_per_unit + qtyChange * unitCost) /
          (before.on_hand + qtyChange)
        : unitCost;
    await supabase
      .from("ingredients")
      .update({ cost_per_unit: Math.round(newAvg * 10000) / 10000 })
      .eq("id", ingredientId);
  }

  revalidatePath("/inventory");
  revalidatePath("/");
}

export async function createIngredient(input: {
  name: string;
  category: string;
  supplier?: string;
  unit?: string;
  low_stock_threshold?: number | null;
  cost_per_unit?: number | null;
  opening_qty?: number;
  /** Product details: one purchased pack ("bag") = pack_size × unit. */
  pack_size?: number | null;
  pack_label?: string | null;
}): Promise<string> {
  const { supabase, user } = await authed();
  const { data, error } = await supabase
    .from("ingredients")
    .insert({
      name: input.name,
      category: input.category,
      supplier: input.supplier || null,
      unit: input.unit || "lb",
      low_stock_threshold: input.low_stock_threshold ?? null,
      cost_per_unit: input.cost_per_unit ?? null,
      // Only sent when given, so the form still works before
      // supabase/product-details.sql has run.
      ...(input.pack_size
        ? {
            pack_size: input.pack_size,
            pack_unit: input.unit || "lb",
            pack_label: input.pack_label || null,
          }
        : {}),
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  if (input.opening_qty) {
    await adjustIngredient(data.id, input.opening_qty, "opening", "Opening stock");
  }
  revalidatePath("/inventory");
  return data.id;
}

/** Edit an ingredient's saved product details. Stock is never edited here:
 *  on-hand stays the sum of the ledger (use a movement to correct a count).
 *  The unit is locked once any ledger row exists, because past quantities
 *  are stored in it — switching lb to kg would silently rescale history.
 *  A cost set here is the working price until the next posted invoice
 *  blends real prices in (weighted average). */
export async function updateIngredient(
  ingredientId: string,
  input: {
    name: string;
    category: string;
    supplier: string | null;
    unit: string;
    cost_per_unit: number | null;
    low_stock_threshold: number | null;
    /** Omit entirely when product-details.sql hasn't run. */
    pack?: { size: number | null; label: string | null };
  }
) {
  const { supabase } = await authed();
  const name = input.name.trim();
  const unit = input.unit.trim();
  if (!name) throw new Error("Name is required.");
  if (!unit) throw new Error("Unit is required.");
  for (const [label, v] of [
    ["Cost", input.cost_per_unit],
    ["Low-stock alert", input.low_stock_threshold],
    ["Pack size", input.pack?.size ?? null],
  ] as const) {
    if (v != null && (!Number.isFinite(v) || v < 0)) throw new Error(`${label} must be zero or more.`);
  }

  const { data: current } = await supabase
    .from("ingredients")
    .select("unit")
    .eq("id", ingredientId)
    .single();
  if (!current) throw new Error("Ingredient not found.");
  if (current.unit !== unit) {
    const { data: rows } = await supabase
      .from("inventory_transactions")
      .select("id")
      .eq("ingredient_id", ingredientId)
      .limit(1);
    if ((rows ?? []).length > 0)
      throw new Error(
        `The unit can't change from ${current.unit} once stock has moved: past quantities are recorded in ${current.unit}.`
      );
  }

  const { error } = await supabase
    .from("ingredients")
    .update({
      name,
      category: input.category,
      supplier: input.supplier?.trim() || null,
      unit,
      cost_per_unit: input.cost_per_unit,
      low_stock_threshold: input.low_stock_threshold,
      ...(input.pack
        ? {
            pack_size: input.pack.size,
            pack_unit: input.pack.size ? unit : null,
            pack_label: input.pack.size ? input.pack.label?.trim() || null : null,
          }
        : {}),
    })
    .eq("id", ingredientId);
  if (error) {
    throw new Error(
      error.message.includes("duplicate") || error.code === "23505"
        ? `Another ingredient is already named "${name}".`
        : error.message
    );
  }
  for (const path of ["/inventory", `/inventory/${ingredientId}`, "/recipes", "/accounting", "/reports", "/orders", "/"])
    revalidatePath(path);
}

export async function createBatch(input: {
  recipe_name: string;
  recipe_id?: string | null;
  batch_number?: string;
  status?: string;
  brew_date?: string;
  batch_size_gal?: number | null;
  brewer?: string;
  notes?: string;
}) {
  const { supabase } = await authed();
  const { data, error } = await supabase
    .from("batches")
    .insert({
      recipe_name: input.recipe_name,
      recipe_id: input.recipe_id ?? null,
      batch_number: input.batch_number || null,
      status: input.status || "Planning",
      brew_date: input.brew_date || null,
      batch_size_gal: input.batch_size_gal ?? null,
      brewer: input.brewer || null,
      notes: input.notes || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  revalidatePath("/batches");
  revalidatePath("/");
  return data.id as string;
}

/** Change a batch's status locally; pushes to Brewfather when linked and enabled. */
export async function updateBatchStatus(batchId: string, status: string) {
  const { supabase } = await authed();
  const { data: batch } = await supabase
    .from("batches")
    .select("brewfather_id")
    .eq("id", batchId)
    .single();

  const { error } = await supabase
    .from("batches")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", batchId);
  if (error) throw new Error(error.message);

  if (
    batch?.brewfather_id &&
    process.env.PUSH_TO_BREWFATHER === "true"
  ) {
    try {
      await setBatchStatus(
        batch.brewfather_id,
        status as "Planning" | "Brewing" | "Fermenting" | "Conditioning" | "Completed" | "Archived"
      );
    } catch (e) {
      // Local update stands; surface the push failure.
      throw new Error(
        `Status saved locally, but Brewfather push failed: ${e instanceof Error ? e.message : e}`
      );
    }
  }
  revalidatePath("/batches");
  revalidatePath("/");
}

export async function addFermentationReading(
  batchId: string,
  input: { gravity?: number | null; temp_f?: number | null; ph?: number | null; note?: string; taken_at?: string | null }
) {
  const { supabase, user } = await authed();
  const { error } = await supabase.from("fermentation_readings").insert({
    batch_id: batchId,
    taken_at: input.taken_at || undefined,
    gravity: input.gravity ?? null,
    temp_f: input.temp_f ?? null,
    ph: input.ph ?? null,
    note: input.note || null,
    created_by: user?.id ?? null,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/batches/${batchId}`);
}

/** Package beer from a batch: records the run AND adds kegs to finished stock. */
export async function logPackaging(input: {
  batch_id: string;
  beer_name: string;
  package_type: string;
  qty: number;
  gallons?: number | null;
  note?: string;
}) {
  const { supabase, user } = await authed();
  const { error: runErr } = await supabase.from("packaging_runs").insert({
    batch_id: input.batch_id,
    package_type: input.package_type,
    qty: input.qty,
    gallons: input.gallons ?? null,
    note: input.note || null,
  });
  if (runErr) throw new Error(runErr.message);

  const { error: fgErr } = await supabase.from("finished_goods_transactions").insert({
    beer_name: input.beer_name,
    package_type: input.package_type,
    qty_change: input.qty,
    reason: "packaged",
    batch_id: input.batch_id,
    note: input.note || null,
    created_by: user?.id ?? null,
  });
  if (fgErr) throw new Error(fgErr.message);
  revalidatePath("/beer");
  revalidatePath("/");
}

export type FgReason = "packaged" | "sold" | "adjustment" | "destroyed" | "returned";

/** Validate a movement date (YYYY-MM-DD, never in the future) and stamp it
 *  the way racking does — noon UTC, so the calendar date is stable in
 *  Chicago time. Returns undefined when no date was given (stamp "now"). */
function stampMovementDate(dateStr?: string | null): string | undefined {
  if (!dateStr) return undefined;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ||
    isNaN(new Date(dateStr + "T12:00:00Z").getTime())
  )
    throw new Error("Enter a valid date.");
  const chicagoToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (dateStr > chicagoToday) throw new Error("Date can't be in the future.");
  return new Date(dateStr + "T12:00:00Z").toISOString();
}

/** Move finished beer: qtyChange negative = out (sold/destroyed), positive = in.
 *  opts.movedAt backdates the movement (late entries land in the right tax
 *  month); opts.batchId links a sale to its batch for batch-level COGS;
 *  opts.approvalRef records the TABC pre-approval for destroyed beer. */
export async function adjustFinishedGoods(
  beerName: string,
  packageType: string,
  qtyChange: number,
  reason: FgReason,
  channel?: "retail" | "on_premise" | "off_premise" | "distributor",
  note?: string,
  opts?: { batchId?: string; movedAt?: string; approvalRef?: string }
) {
  const { supabase, user } = await authed();
  const stamped = stampMovementDate(opts?.movedAt);
  const { error } = await supabase.from("finished_goods_transactions").insert({
    beer_name: beerName,
    package_type: packageType,
    qty_change: qtyChange,
    reason,
    channel: channel || null,
    batch_id: opts?.batchId || null,
    approval_ref: opts?.approvalRef || null,
    note: note || null,
    created_by: user?.id ?? null,
    ...(stamped ? { created_at: stamped } : {}),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/beer");
  revalidatePath("/reports");
  revalidatePath("/");
}

/** Log a keg/case going ON TAP. Stock-neutral by design: tapping moves a
 *  keg to the tap, it does not remove it from finished inventory — the
 *  later "sold" movement does that. Poured volume = taps x package size. */
export async function logTapEvent(input: {
  beer_name: string;
  package_type: string;
  qty: number;
  batch_id?: string | null;
  tapped_at?: string | null;
  note?: string;
}) {
  const { supabase, user } = await authed();
  if (!input.beer_name.trim() || !input.qty || input.qty <= 0)
    throw new Error("Enter a beer and a quantity.");
  const stamped = stampMovementDate(input.tapped_at);
  const { error } = await supabase.from("tap_events").insert({
    beer_name: input.beer_name.trim(),
    package_type: input.package_type,
    qty: input.qty,
    batch_id: input.batch_id || null,
    note: input.note || null,
    created_by: user?.id ?? null,
    ...(stamped ? { tapped_at: stamped, created_at: stamped } : {}),
  });
  if (error) throw new Error(error.message);
  revalidatePath("/beer");
  revalidatePath("/reports");
  revalidatePath("/");
}

/** Execute a voice-parsed action after the user confirms it. */
export async function executeVoiceAction(a: VoiceAction): Promise<string> {
  const { supabase } = await authed();

  async function findIngredient(name: string) {
    const { data } = await supabase
      .from("ingredients")
      .select("id,name,unit")
      .ilike("name", `%${name}%`)
      .limit(1)
      .maybeSingle();
    if (!data) throw new Error(`No ingredient matching "${name}" found.`);
    return data;
  }

  async function findBatch(name?: string) {
    if (!name) {
      const { data } = await supabase
        .from("batches")
        .select("id,recipe_name")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) throw new Error("No batches found — create one first.");
      return data;
    }
    const { data } = await supabase
      .from("batches")
      .select("id,recipe_name")
      .ilike("recipe_name", `%${name}%`)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) throw new Error(`No batch matching "${name}" found.`);
    return data;
  }

  switch (a.type) {
    case "use_ingredient": {
      const ing = await findIngredient(a.ingredient!);
      const batch = a.batch ? await findBatch(a.batch).catch(() => null) : null;
      await adjustIngredient(ing.id, -(a.qty ?? 0), "brew_usage", a.summary, batch?.id);
      return `Logged: ${a.summary}`;
    }
    case "receive_ingredient": {
      const ing = await findIngredient(a.ingredient!);
      await adjustIngredient(ing.id, a.qty ?? 0, "purchase", a.summary);
      return `Logged: ${a.summary}`;
    }
    case "log_reading": {
      const batch = await findBatch(a.batch);
      await addFermentationReading(batch.id, {
        gravity: a.gravity ?? null,
        temp_f: a.temp_f ?? null,
        note: a.note ?? a.summary,
      });
      return `Logged: ${a.summary}`;
    }
    case "package_beer": {
      const batch = await findBatch(a.beer);
      await logPackaging({
        batch_id: batch.id,
        beer_name: a.beer!,
        package_type: a.package_type || "Half-barrel keg",
        qty: a.qty ?? 0,
        note: a.summary,
      });
      return `Logged: ${a.summary}`;
    }
    case "move_beer": {
      await adjustFinishedGoods(
        a.beer!,
        a.package_type || "Half-barrel keg",
        a.qty ?? 0,
        (a.reason as FgReason) || "sold",
        (a.channel as "retail" | "on_premise" | "off_premise" | "distributor") || undefined,
        a.summary
      );
      return `Logged: ${a.summary}`;
    }
    default:
      throw new Error(a.summary || "Didn't understand that — try simpler wording.");
  }
}

export interface OrderLineInput {
  ingredient_id: string | null;
  ingredient_name: string;
  supplier: string | null;
  qty: number;
  unit: string;
  unit_cost: number | null;
  note?: string | null;
}

/** Save a brew-plan order (a snapshot: later inventory moves never rewrite
 *  it). Returns the order id. */
export async function createIngredientOrder(
  lines: OrderLineInput[],
  note?: string
): Promise<string> {
  const { supabase, user } = await authed();
  const clean = lines.filter((l) => l.qty > 0 && l.ingredient_name.trim());
  if (clean.length === 0) throw new Error("Nothing to order — every need is covered by stock on hand.");
  const { data: order, error: oErr } = await supabase
    .from("ingredient_orders")
    .insert({ note: note || null, created_by: user?.id ?? null })
    .select("id")
    .single();
  if (oErr) throw new Error(oErr.message);
  const { error: lErr } = await supabase.from("ingredient_order_lines").insert(
    clean.map((l) => ({
      order_id: order.id,
      ingredient_id: l.ingredient_id,
      ingredient_name: l.ingredient_name.trim(),
      supplier: l.supplier,
      qty: Math.round(l.qty * 100) / 100,
      unit: l.unit,
      unit_cost: l.unit_cost,
      note: l.note || null,
    }))
  );
  if (lErr) throw new Error(lErr.message);
  revalidatePath("/orders");
  return order.id as string;
}

/** Mark an order sent (records when it went to the supplier). */
export async function markOrderSent(orderId: string) {
  const { supabase } = await authed();
  const { error } = await supabase
    .from("ingredient_orders")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", orderId);
  if (error) throw new Error(error.message);
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
}

/** Delete a draft order. Sent orders are kept as the record. */
export async function deleteIngredientOrder(orderId: string) {
  const { supabase } = await authed();
  const { data: order } = await supabase
    .from("ingredient_orders")
    .select("status")
    .eq("id", orderId)
    .single();
  if (!order) throw new Error("Order not found.");
  if (order.status !== "draft") throw new Error("Only draft orders can be deleted.");
  const { error } = await supabase.from("ingredient_orders").delete().eq("id", orderId);
  if (error) throw new Error(error.message);
  revalidatePath("/orders");
}

/** Set (or update) a beer's taproom pint price, used for margin math. */
export async function setBeerPrice(beerName: string, price: number) {
  const { supabase } = await authed();
  const clean = beerName.trim();
  if (!clean) throw new Error("Beer name is required.");
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Pint price must be greater than zero.");
  }
  const { error } = await supabase.from("beer_prices").upsert(
    { beer_name: clean, pint_price: price, updated_at: new Date().toISOString() },
    { onConflict: "beer_name" }
  );
  if (error) throw new Error(error.message);
  revalidatePath("/accounting");
  revalidatePath("/beer");
}

export interface ScanLineInput {
  id?: string;
  batch_id: string | null;
  batch_label: string | null;
  taken_at: string | null;
  plato: number | null;
  temp_f: number | null;
  action: string | null;
}

async function getDraftScan(scanId: string) {
  const { supabase } = await authed();
  const { data: scan } = await supabase
    .from("fermentation_scans")
    .select("id,status")
    .eq("id", scanId)
    .single();
  if (!scan) throw new Error("Scan not found.");
  if (scan.status !== "draft") throw new Error("This scan was already posted.");
  return { supabase, scan };
}

/** Replace a draft scan's rows with the reviewed set. */
export async function saveFermentationScanLines(scanId: string, lines: ScanLineInput[]) {
  const { supabase } = await getDraftScan(scanId);
  const { error: delErr } = await supabase
    .from("fermentation_scan_lines")
    .delete()
    .eq("scan_id", scanId);
  if (delErr) throw new Error(delErr.message);
  const rows = lines
    .filter((l) => l.taken_at || l.plato != null || l.temp_f != null || l.batch_id)
    .map((l) => ({
      scan_id: scanId,
      batch_id: l.batch_id || null,
      batch_label: l.batch_label || null,
      taken_at: l.taken_at || null,
      plato: l.plato,
      temp_f: l.temp_f,
      action: l.action || null,
    }));
  if (rows.length) {
    const { error } = await supabase.from("fermentation_scan_lines").insert(rows);
    if (error) throw new Error(error.message);
  }
  revalidatePath(`/fermentation/${scanId}`);
}

/**
 * Post a reviewed scan: convert °Plato to SG and write fermentation_readings.
 * Skips rows already in the log (same batch + date + gravity) so a sheet
 * can be re-scanned safely.
 */
export async function postFermentationScan(scanId: string): Promise<{
  posted: number;
  skipped: number;
  /** One line per batch: newest reading sent to Brewfather, or why not.
   *  Empty when the Custom Stream isn't set up. */
  brewfather: StreamPushResult[];
}> {
  const { supabase, user } = await authed();
  const { scan } = await getDraftScan(scanId);
  void scan;
  const { platoToSG } = await import("@/lib/fermentation");

  const { data: lines } = await supabase
    .from("fermentation_scan_lines")
    .select("*")
    .eq("scan_id", scanId)
    .order("taken_at", { ascending: true });
  const rows = (lines ?? []).filter(
    (l) => l.batch_id && l.taken_at && l.plato != null
  ) as { id: string; batch_id: string; taken_at: string; plato: number; temp_f: number | null; action: string | null }[];
  if (rows.length === 0) {
    throw new Error("Nothing to post — every row needs a batch, a date, and a Plato reading.");
  }

  const batchIds = [...new Set(rows.map((r) => r.batch_id))];
  const { data: existing } = await supabase
    .from("fermentation_readings")
    .select("batch_id,taken_at,gravity")
    .in("batch_id", batchIds);
  const seen = new Set(
    (existing ?? []).map(
      (e) =>
        `${e.batch_id}|${String(e.taken_at).slice(0, 10)}|${Number(e.gravity).toFixed(3)}`
    )
  );

  let posted = 0;
  let skipped = 0;
  const postedBatches = new Set<string>();
  for (const r of rows) {
    const sg = platoToSG(Number(r.plato));
    const key = `${r.batch_id}|${String(r.taken_at).slice(0, 10)}|${sg.toFixed(3)}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const { error } = await supabase.from("fermentation_readings").insert({
      batch_id: r.batch_id,
      taken_at: r.taken_at,
      gravity: sg,
      plato: r.plato,
      temp_f: r.temp_f,
      // Cellar actions (e.g. dry hops) live in the note — Brewfather has
      // no field for them, so the note is the record.
      note: r.action || null,
      created_by: user?.id ?? null,
    });
    if (error) throw new Error(error.message);
    posted++;
    postedBatches.add(r.batch_id);
    revalidatePath(`/batches/${r.batch_id}`);
  }

  await supabase.from("fermentation_scans").update({ status: "posted" }).eq("id", scanId);

  // Newest reading per tank → Brewfather (Custom Stream). Best-effort: the
  // readings above are posted no matter what Brewfather says.
  const brewfather = await pushLatestReadings(supabase, [...postedBatches]);

  revalidatePath("/fermentation");
  for (const t of brewfather) if (t.tank) revalidatePath(`/fermentation/tanks/${t.tank}`);
  return { posted, skipped, brewfather };
}

/** Tank page button: send the tank's newest reading to Brewfather now
 *  (retry after a failure, or after the 15-minute window). */
export async function sendTankReadingToBrewfather(formData: FormData) {
  const tank = Number(formData.get("tank_number"));
  if (!tank || tank < 1 || tank > 6) throw new Error("Invalid tank.");
  const { supabase } = await authed();
  const { data: a } = await supabase
    .from("tank_assignments")
    .select("batch_id")
    .eq("tank_number", tank)
    .is("released_at", null)
    .maybeSingle();
  if (!a) throw new Error("That tank is empty.");
  const [r] = await pushLatestReadings(supabase, [a.batch_id], { force: true });
  revalidatePath(`/fermentation/tanks/${tank}`);
  const q = new URLSearchParams({
    bfstream: r?.status ?? "skipped",
    detail: r?.detail ?? "The Brewfather stream isn't set up (BREWFATHER_STREAM_URL).",
  });
  redirect(`/fermentation/tanks/${tank}?${q}`);
}

/** Delete a draft scan (and its rows, plus the stored sheet file). Posted
 *  scans can't be deleted — their readings are already in the log. */
export async function deleteFermentationScan(scanId: string) {
  const { supabase } = await authed();
  const { data: scan } = await supabase
    .from("fermentation_scans")
    .select("id,status,file_path")
    .eq("id", scanId)
    .single();
  if (!scan) throw new Error("Scan not found.");
  if (scan.status !== "draft") throw new Error("Only draft scans can be deleted.");
  if (scan.file_path) {
    await supabase.storage.from("fermentation-sheets").remove([scan.file_path]);
  }
  const { error } = await supabase.from("fermentation_scans").delete().eq("id", scanId);
  if (error) throw new Error(error.message);
  revalidatePath("/fermentation");
}

/** Put a batch in a tank, releasing whatever was there before. */
export async function assignTank(formData: FormData) {
  const tank = Number(formData.get("tank_number"));
  const batchId = String(formData.get("batch_id") ?? "");
  const volIn = Number(formData.get("volume_in_bbl") ?? "");
  if (!tank || tank < 1 || tank > 6) throw new Error("Invalid tank.");
  if (!batchId) throw new Error("Choose a batch to put in the tank.");
  const { supabase } = await authed();
  await supabase
    .from("tank_assignments")
    .update({ released_at: new Date().toISOString() })
    .eq("tank_number", tank)
    .is("released_at", null);
  const { error } = await supabase.from("tank_assignments").insert({
    tank_number: tank,
    batch_id: batchId,
    volume_in_bbl:
      volIn > 0 ? Math.round(volIn * 100) / 100 : null,
  });
  if (error) {
    throw new Error(
      error.message.includes("uq_batch_current")
        ? "That batch is already in another tank."
        : error.message
    );
  }
  revalidatePath("/fermentation");
  revalidatePath(`/fermentation/tanks/${tank}`);
}

/** Empty a tank. History is kept via released_at. */
export async function emptyTank(formData: FormData) {
  const tank = Number(formData.get("tank_number"));
  if (!tank || tank < 1 || tank > 6) throw new Error("Invalid tank.");
  const { supabase } = await authed();
  const { error } = await supabase
    .from("tank_assignments")
    .update({ released_at: new Date().toISOString() })
    .eq("tank_number", tank)
    .is("released_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/fermentation");
  revalidatePath(`/fermentation/tanks/${tank}`);
}

/** Edit the barrels of wort recorded for a tank's current batch. */
export async function updateTankVolumeIn(formData: FormData) {
  const tank = Number(formData.get("tank_number"));
  const volIn = Number(formData.get("volume_in_bbl") ?? "");
  if (!tank || tank < 1 || tank > 6) throw new Error("Invalid tank.");
  const { supabase } = await authed();
  const { error } = await supabase
    .from("tank_assignments")
    .update({
      volume_in_bbl: volIn > 0 ? Math.round(volIn * 100) / 100 : null,
    })
    .eq("tank_number", tank)
    .is("released_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/fermentation");
  revalidatePath(`/fermentation/tanks/${tank}`);
}

/**
 * Rack a tank: record barrels yielded, release the tank, and post the
 * equivalent half-barrel kegs (1 bbl = 2 kegs) to finished beer inventory.
 * Finished beer only exists in 15.5-gallon kegs, so the barrelage is the
 * record and kegs are what enter inventory. The rack date is explicit and
 * editable (defaults to today) — it stamps both the tank release and the
 * finished-beer transaction, so the rack lands in the correct tax month
 * even when entered later.
 */
export async function rackTank(formData: FormData) {
  const tank = Number(formData.get("tank_number"));
  const bbl = Math.round(Number(formData.get("volume_out_bbl") ?? "") * 100) / 100;
  const dateStr = String(formData.get("racked_at") ?? "");
  if (!tank || tank < 1 || tank > 6) throw new Error("Invalid tank.");
  if (!bbl || bbl <= 0) throw new Error("Enter the barrels racked.");
  const kegs = bbl * 2;
  if (!Number.isInteger(kegs))
    throw new Error("Barrels must be in half-barrel increments (0.5 bbl = 1 keg).");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dateStr) ||
    isNaN(new Date(dateStr + "T12:00:00Z").getTime())
  )
    throw new Error("Enter a valid rack date.");
  const chicagoToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  if (dateStr > chicagoToday) throw new Error("Rack date can't be in the future.");
  // Noon UTC = morning in Chicago: the calendar date is stable in his timezone.
  const rackedAt = new Date(dateStr + "T12:00:00Z").toISOString();
  const { supabase, user } = await authed();

  const { data: a } = await supabase
    .from("tank_assignments")
    .select("id,batch_id")
    .eq("tank_number", tank)
    .is("released_at", null)
    .maybeSingle();
  if (!a) throw new Error("That tank is empty.");
  const { data: b } = await supabase
    .from("batches")
    .select("id,recipe_name,batch_number,brewfather_id")
    .eq("id", a.batch_id)
    .single();

  const { data: fg, error: fgErr } = await supabase
    .from("finished_goods_transactions")
    .insert({
      beer_name: b?.recipe_name ?? "Unknown",
      package_type: "Half-barrel keg",
      qty_change: kegs,
      reason: "packaged",
      batch_id: a.batch_id,
      note: `Racked from Tank ${tank}: ${bbl} bbl = ${kegs} kegs${b?.batch_number ? ` (batch #${b.batch_number})` : ""}`,
      created_by: user?.id ?? null,
      created_at: rackedAt,
    })
    .select("id")
    .single();
  if (fgErr) throw new Error(fgErr.message);

  const { error: upErr } = await supabase
    .from("tank_assignments")
    .update({ volume_out_bbl: bbl, released_at: rackedAt })
    .eq("id", a.id);
  if (upErr) {
    await supabase.from("finished_goods_transactions").delete().eq("id", fg.id);
    throw new Error(upErr.message);
  }

  // Batch is done: mark it Completed locally, then push the completion to
  // Brewfather (status + final gravity + kegged volume). Readings can't be
  // pushed — Brewfather's API has no readings write endpoint — so the
  // fermentation log stays in the app.
  await supabase
    .from("batches")
    .update({ status: "Completed", updated_at: new Date().toISOString() })
    .eq("id", a.batch_id);

  if (b?.brewfather_id) {
    const { data: r } = await supabase
      .from("fermentation_readings")
      .select("gravity")
      .eq("batch_id", a.batch_id)
      .not("gravity", "is", null)
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    try {
      await pushBatchUpdate(b.brewfather_id, {
        status: "Completed",
        measuredFg: r?.gravity != null ? Number(r.gravity) : undefined,
        measuredBottlingSize:
          Math.round(bbl * LITERS_PER_BARREL * 10) / 10,
      });
    } catch (e) {
      // Local rack stands; the tank page shows a retry banner.
      const reason =
        e instanceof Error && e.message.includes("403") ? "scope" : "error";
      redirect(`/fermentation/tanks/${tank}?bfpush=failed&reason=${reason}`);
    }
  }

  revalidatePath("/fermentation");
  revalidatePath(`/fermentation/tanks/${tank}`);
  revalidatePath("/beer");
  revalidatePath("/batches");
  revalidatePath("/");
}

/** Retry a failed Brewfather completion push for a tank's last rack. */
export async function retryBrewfatherPush(formData: FormData) {
  const tank = Number(formData.get("tank_number"));
  if (!tank || tank < 1 || tank > 6) throw new Error("Invalid tank.");
  const { supabase } = await authed();

  const { data: a } = await supabase
    .from("tank_assignments")
    .select("batch_id,volume_out_bbl")
    .eq("tank_number", tank)
    .not("volume_out_bbl", "is", null)
    .order("released_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!a) throw new Error("No rack found for that tank.");
  const { data: b } = await supabase
    .from("batches")
    .select("brewfather_id")
    .eq("id", a.batch_id)
    .single();
  if (!b?.brewfather_id)
    throw new Error("That batch isn't linked to Brewfather.");
  const { data: r } = await supabase
    .from("fermentation_readings")
    .select("gravity")
    .eq("batch_id", a.batch_id)
    .not("gravity", "is", null)
    .order("taken_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  try {
    await pushBatchUpdate(b.brewfather_id, {
      status: "Completed",
      measuredFg: r?.gravity != null ? Number(r.gravity) : undefined,
      measuredBottlingSize:
        Math.round(Number(a.volume_out_bbl) * LITERS_PER_BARREL * 10) / 10,
    });
  } catch (e) {
    const reason =
      e instanceof Error && e.message.includes("403") ? "scope" : "error";
    redirect(`/fermentation/tanks/${tank}?bfpush=failed&reason=${reason}`);
  }
  redirect(`/fermentation/tanks/${tank}?bfpush=ok`);
}
