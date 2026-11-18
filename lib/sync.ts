import {
  listBatches,
  listRecipes,
  getRecipe,
  listInventory,
  INVENTORY_CATEGORIES,
  type BrewfatherStatus,
  type BrewfatherInventoryItem,
  type BrewfatherRecipe,
} from "./brewfather";
import { createServiceClient } from "./supabase/server";

const LITERS_PER_GALLON = 3.78541;

/** Batch statuses that mean beer is actually being made (not just planned). */
const ACTIVE_BATCH_STATUSES = new Set([
  "Brewing",
  "Fermenting",
  "Conditioning",
  "Completed",
]);

export interface DeductibleBatch {
  batchId: string;
  batchName: string;
  /** Linked library recipe (fallback bill), when one matched. */
  recipeId: string | null;
  /** The batch's own bill from Brewfather (scaled/edited for this brew).
   *  Preferred over the library recipe, which may differ. */
  bill: RecipeIngredient[] | null;
}

/** The ingredient bill embedded in a Brewfather batch (complete=true
 *  returns the batch's own copy of the recipe, scaled to this brew). */
function batchBill(b: { recipe?: unknown }): RecipeIngredient[] | null {
  const r = b.recipe as BrewfatherRecipe | undefined;
  if (!r || typeof r !== "object") return null;
  const has = [r.fermentables, r.hops, r.yeasts, r.miscs].some(
    (x) => Array.isArray(x) && x.length > 0
  );
  return has ? normalizeRecipeIngredients(r) : null;
}

/** Pull Brewfather batches into our batches table (upsert on brewfather_id),
 *  linking each batch to its recipe. Returns batches that became "brewed"
 *  on this run — newly synced active batches, plus batches that moved from
 *  Planning to an active status — so their ingredients can be auto-deducted.
 *  Batches already in the table with an active status are never touched:
 *  their ingredients were consumed before this feature existed, and the
 *  Oct 19 physical counts already reflect that. */
export async function syncBatchesFromBrewfather(
  recipeByBrewfatherId: Map<string, string>,
  recipeByName: Map<string, string>
): Promise<{
  upserted: number;
  byStatus: Record<string, number>;
  deductible: DeductibleBatch[];
}> {
  const supabase = await createServiceClient();
  const statuses: BrewfatherStatus[] = [
    "Planning",
    "Brewing",
    "Fermenting",
    "Conditioning",
    "Completed",
  ];
  const { data: existingRows } = await supabase
    .from("batches")
    .select("brewfather_id,status");
  const { data: recipeOgs } = await supabase
    .from("recipes")
    .select("id,og");
  const ogByRecipeId = new Map(
    (recipeOgs ?? [])
      .filter((r) => r.og != null)
      .map((r) => [r.id as string, Number(r.og)])
  );
  const existing = new Map(
    (existingRows ?? [])
      .filter((r) => r.brewfather_id)
      .map((r) => [r.brewfather_id as string, r.status as string])
  );
  let upserted = 0;
  const byStatus: Record<string, number> = {};
  const deductible: DeductibleBatch[] = [];

  for (const status of statuses) {
    const batches = await listBatches(status);
    byStatus[status] = batches.length;
    for (const b of batches) {
      const recipeRef = b.recipe as { _id?: unknown; name?: string } | undefined;
      const recipeName = recipeRef?.name ?? b.name ?? "Untitled batch";
      const bfRecipeId =
        typeof recipeRef?._id === "string" ? recipeRef._id : null;
      const recipeId =
        (bfRecipeId ? recipeByBrewfatherId.get(bfRecipeId) : undefined) ??
        recipeByName.get(normalizeName(recipeName)) ??
        null;
      // OG: measured wins; else the linked recipe's OG. Only written when
      // known — never overwrite a stored OG with null.
      const ogValue =
        typeof b.measuredOg === "number"
          ? b.measuredOg
          : recipeId
            ? (ogByRecipeId.get(recipeId) ?? null)
            : null;
      const row = {
        brewfather_id: b._id,
        batch_number: b.batchNo != null ? String(b.batchNo) : null,
        recipe_name: recipeName,
        recipe_id: recipeId,
        status: b.status,
        brew_date: b.brewDate
          ? new Date(b.brewDate as number).toISOString().slice(0, 10)
          : null,
        batch_size_gal:
          typeof b.batchSize === "number"
            ? +(b.batchSize / LITERS_PER_GALLON).toFixed(2)
            : null,
        brewer: (b.brewer as string | undefined) ?? null,
        ...(ogValue != null ? { og: ogValue } : {}),
        updated_at: new Date().toISOString(),
      };
      const { data: saved, error } = await supabase
        .from("batches")
        .upsert(row, { onConflict: "brewfather_id" })
        .select("id")
        .single();
      if (error) throw new Error(`Batch upsert failed: ${error.message}`);
      upserted++;
      const wasNew = !existing.has(b._id);
      const wasPlanning = existing.get(b._id) === "Planning";
      const bill = batchBill(b);
      // Deduct from the batch's own bill; fall back to the linked recipe.
      // A batch with neither is still reported (see autoDeductBatch) instead
      // of being skipped without a trace.
      if ((wasNew || wasPlanning) && ACTIVE_BATCH_STATUSES.has(b.status) && saved) {
        deductible.push({ batchId: saved.id, batchName: recipeName, recipeId, bill });
      }
    }
  }
  return { upserted, byStatus, deductible };
}

/** Read-only snapshot of Brewfather inventory (for the Settings page). */
export async function snapshotBrewfatherInventory(): Promise<
  { category: string; items: BrewfatherInventoryItem[] }[]
> {
  const out: { category: string; items: BrewfatherInventoryItem[] }[] = [];
  for (const category of INVENTORY_CATEGORIES) {
    const items = await listInventory(category);
    out.push({ category, items });
  }
  return out;
}

// ── Recipes ────────────────────────────────────────────────────────────

export interface RecipeIngredient {
  name: string;
  category: "grain" | "hops" | "yeast" | "adjunct";
  amount: number | null;
  unit: string;
  note: string | null;
}

const KG_TO_LB = 2.20462;
const G_TO_OZ = 0.035274;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Normalize a Brewfather recipe's bill into grain / hops / yeast / adjunct
 *  lines with US units (Brewfather's API returns metric: kg and grams). */
export function normalizeRecipeIngredients(r: BrewfatherRecipe): RecipeIngredient[] {
  const out: RecipeIngredient[] = [];

  for (const f of r.fermentables ?? []) {
    const type = String(f.type ?? "Grain");
    const kg = typeof f.amount === "number" ? f.amount : null;
    out.push({
      name: String(f.name ?? "Fermentable"),
      category: type === "Sugar" || type === "Adjunct" ? "adjunct" : "grain",
      amount: kg != null ? r2(kg * KG_TO_LB) : null,
      unit: "lb",
      note: null,
    });
  }
  for (const h of r.hops ?? []) {
    const g = typeof h.amount === "number" ? h.amount : null;
    const parts = [
      typeof h.use === "string" ? h.use : null,
      typeof h.time === "number" ? `${h.time} min` : null,
      typeof h.alpha === "number" ? `${h.alpha}% AA` : null,
    ].filter(Boolean);
    out.push({
      name: String(h.name ?? "Hop"),
      category: "hops",
      amount: g != null ? r2(g * G_TO_OZ) : null,
      unit: "oz",
      note: parts.length ? parts.join(" · ") : null,
    });
  }
  for (const y of r.yeasts ?? []) {
    // Brewfather yeast amounts carry their own unit (pkg, g, ml).
    const yUnit = typeof y.unit === "string" && y.unit.trim() ? y.unit.trim() : "pkg";
    out.push({
      name: [y.laboratory, y.name].filter(Boolean).join(" ") || "Yeast",
      category: "yeast",
      amount: typeof y.amount === "number" ? y.amount : null,
      unit: yUnit,
      note: typeof y.attenuation === "number" ? `${y.attenuation}% attenuation` : null,
    });
  }
  for (const m of r.miscs ?? []) {
    out.push({
      name: String(m.name ?? "Misc"),
      category: "adjunct",
      amount: typeof m.amount === "number" ? m.amount : null,
      unit: typeof m.unit === "string" ? m.unit : "g",
      note: typeof m.use === "string" ? m.use : null,
    });
  }
  return out;
}

/** Pull Brewfather recipes (with full ingredient bills) into our recipes table. */
export async function syncRecipesFromBrewfather(): Promise<{
  upserted: number;
  byBrewfatherId: Map<string, string>;
  byName: Map<string, string>;
}> {
  const supabase = await createServiceClient();
  const recipes = await listRecipes();
  let upserted = 0;

  for (const r of recipes) {
    let full = r;
    if (!r.fermentables && !r.hops && !r.yeasts && !r.miscs) {
      try {
        full = await getRecipe(r._id);
      } catch {
        full = r;
      }
    }
    const style =
      typeof full.style === "object" && full.style
        ? (full.style.name ?? null)
        : typeof full.style === "string"
          ? full.style
          : null;
    const { error } = await supabase.from("recipes").upsert(
      {
        brewfather_id: full._id,
        name: full.name ?? "Untitled recipe",
        style,
        batch_size_gal:
          typeof full.batchSize === "number"
            ? +(full.batchSize / LITERS_PER_GALLON).toFixed(2)
            : null,
        og: typeof full.og === "number" ? full.og : null,
        fg: typeof full.fg === "number" ? full.fg : null,
        abv: typeof full.abv === "number" ? full.abv : null,
        ibu: typeof full.ibu === "number" ? full.ibu : null,
        ingredients: normalizeRecipeIngredients(full),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "brewfather_id" }
    );
    if (error) throw new Error(`Recipe upsert failed: ${error.message}`);
    upserted++;
  }
  const { data: rows } = await supabase.from("recipes").select("id,brewfather_id,name");
  const byBrewfatherId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const r of rows ?? []) {
    if (r.brewfather_id) byBrewfatherId.set(r.brewfather_id, r.id);
    byName.set(normalizeName(r.name), r.id);
  }
  return { upserted, byBrewfatherId, byName };
}

/** Full sync: recipes + ingredient catalog + batches + auto-deduct.
 *  Catalog runs before batches so substitutes pulled from Brewfather
 *  inventory exist (with opening balances) before a new batch deducts. */
export async function syncFromBrewfather() {
  const recipes = await syncRecipesFromBrewfather();
  const catalog = await syncInventoryCatalogFromBrewfather();
  const batches = await syncBatchesFromBrewfather(
    recipes.byBrewfatherId,
    recipes.byName
  );
  const autoDeduct = await autoDeductNewBatches(batches.deductible);
  return {
    batches: { upserted: batches.upserted, byStatus: batches.byStatus },
    recipes: { upserted: recipes.upserted },
    catalog,
    autoDeduct,
  };
}

// ── Ingredient catalog (from Brewfather inventory) ─────────────────────

import { listInventoryCatalog } from "./brewfather";
import { normalizeName } from "./match";

const BF_CATEGORY_MAP: Record<string, { category: string; unit: string }> = {
  fermentables: { category: "grain", unit: "lb" },
  hops: { category: "hops", unit: "oz" },
  yeasts: { category: "yeast", unit: "pkg" },
  miscs: { category: "adjunct", unit: "g" },
};

/**
 * Bring Brewfather's inventory catalog into our ingredients table so hops,
 * yeast, and miscs exist as sections — not just the grains we hand-seeded.
 * Existing ingredients are never touched. Brand-new items also get an
 * opening-balance transaction from Brewfather's on-hand amount (metric →
 * US: fermentables kg→lb, hops g→oz), clearly labeled in the ledger.
 */
export async function syncInventoryCatalogFromBrewfather(): Promise<{
  created: number;
  skipped: number;
}> {
  const supabase = await createServiceClient();
  const { data: existing } = await supabase.from("ingredients").select("id,name");
  const known = new Map((existing ?? []).map((i) => [normalizeName(i.name), i.id]));
  let created = 0;
  let skipped = 0;

  for (const bfCat of INVENTORY_CATEGORIES) {
    const items = await listInventoryCatalog(bfCat);
    const fallback = BF_CATEGORY_MAP[bfCat];
    for (const item of items) {
      const displayName = [item.laboratory, item.name]
        .filter(Boolean)
        .join(" ")
        .trim();
      if (!displayName || known.has(normalizeName(displayName))) {
        skipped++;
        continue;
      }
      let category = fallback.category;
      if (bfCat === "fermentables") {
        const t = String(item.type ?? "Grain");
        if (t === "Sugar" || t === "Adjunct") category = "adjunct";
      }
      const { data: ing, error } = await supabase
        .from("ingredients")
        .insert({ name: displayName, category, unit: fallback.unit })
        .select("id")
        .single();
      if (error) {
        skipped++;
        continue;
      }
      known.set(normalizeName(displayName), ing.id);
      created++;

      const raw = typeof item.inventory === "number" ? item.inventory : 0;
      if (raw > 0) {
        let qty = raw;
        if (bfCat === "fermentables") qty = Math.round(raw * KG_TO_LB * 100) / 100;
        if (bfCat === "hops") qty = Math.round(raw * G_TO_OZ * 100) / 100;
        const { error: txnErr } = await supabase.from("inventory_transactions").insert({
          ingredient_id: ing.id,
          qty_change: qty,
          unit: fallback.unit,
          reason: "opening",
          note: "Opening balance from Brewfather inventory",
        });
        if (txnErr) console.error("catalog opening txn:", txnErr.message);
      }
    }
  }
  return { created, skipped };
}

// ── Auto-deduct new Brewfather batches ───────────────────────────────

import { planDeduction, type StockCandidate, type RecipeLine } from "./substitute";

export interface AutoDeductReportLine {
  recipe_ingredient: string;
  recipe_qty: number | null;
  recipe_unit: string;
  used_ingredient: string | null;
  used_qty: number | null;
  used_unit: string | null;
  substituted: boolean;
  shortage: boolean;
  skipped_reason: string | null;
}

/** Deduct one newly brewed batch's recipe bill from on-hand inventory,
 *  substituting the closest on-hand variety when the exact brand isn't
 *  there. Every deduction is a normal brew_usage ledger row (so batch
 *  costing and the audit trail work unchanged), and the full plan is
 *  saved on the batch as auto_deduct_report for review. */
async function autoDeductBatch(batch: DeductibleBatch): Promise<{
  allocations: number;
  substitutions: number;
  shortages: number;
  skipped: number;
}> {
  const supabase = await createServiceClient();
  let lines: RecipeLine[] = (batch.bill ?? []) as RecipeLine[];
  let source = "batch";
  if (lines.length === 0 && batch.recipeId) {
    const { data: recipe } = await supabase
      .from("recipes")
      .select("ingredients")
      .eq("id", batch.recipeId)
      .single();
    lines = (recipe?.ingredients ?? []) as RecipeLine[];
    source = "recipe";
  }
  if (lines.length === 0) {
    // Nothing to deduct from: say so on the batch rather than staying silent.
    await supabase
      .from("batches")
      .update({
        auto_deduct_report: {
          deducted_at: new Date().toISOString(),
          source: "none",
          lines: [
            {
              recipe_ingredient: "(whole batch)",
              recipe_qty: null,
              recipe_unit: "",
              used_ingredient: null,
              used_qty: null,
              used_unit: null,
              substituted: false,
              shortage: false,
              skipped_reason:
                "No ingredient bill: the Brewfather batch had none and no recipe matched. Log usage on this batch by hand.",
            },
          ],
        },
      })
      .eq("id", batch.batchId);
    return { allocations: 0, substitutions: 0, shortages: 0, skipped: 1 };
  }
  const { data: stock } = await supabase
    .from("ingredient_stock")
    .select("id,name,category,unit,on_hand,cost_per_unit");

  // Running on-hand balances, so lines in the same batch don't over-draw.
  const running = new Map(
    (stock ?? []).map((s) => [s.id, Number(s.on_hand)])
  );
  const reportLines: AutoDeductReportLine[] = [];
  let allocations = 0;
  let substitutions = 0;
  let shortages = 0;
  let skipped = 0;

  for (const line of lines) {
    const candidates: StockCandidate[] = (stock ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      unit: s.unit,
      onHand: running.get(s.id) ?? 0,
      costPerUnit: s.cost_per_unit != null ? Number(s.cost_per_unit) : null,
    }));
    const plan = planDeduction(line, candidates);
    if (plan.skippedReason) {
      skipped++;
      reportLines.push({
        recipe_ingredient: line.name,
        recipe_qty: line.amount,
        recipe_unit: line.unit,
        used_ingredient: null,
        used_qty: null,
        used_unit: null,
        substituted: false,
        shortage: false,
        skipped_reason: plan.skippedReason,
      });
      continue;
    }
    if (plan.shortage) shortages++;
    for (const a of plan.allocations) {
      allocations++;
      if (a.substituted) substitutions++;
      const note =
        `Auto-deduct for batch "${batch.batchName}"` +
        (a.substituted ? ` — used ${a.ingredientName} in place of ${line.name}` : "") +
        (a.shortage ? " — SHORT: on-hand went negative" : "");
      const { error } = await supabase.from("inventory_transactions").insert({
        ingredient_id: a.ingredientId,
        qty_change: -a.qty,
        unit: a.unit,
        reason: "brew_usage",
        batch_id: batch.batchId,
        unit_cost: a.unitCost,
        note,
      });
      if (error) throw new Error(`Auto-deduct failed: ${error.message}`);
      running.set(a.ingredientId, (running.get(a.ingredientId) ?? 0) - a.qty);
      reportLines.push({
        recipe_ingredient: line.name,
        recipe_qty: line.amount,
        recipe_unit: line.unit,
        used_ingredient: a.ingredientName,
        used_qty: a.qty,
        used_unit: a.unit,
        substituted: a.substituted,
        shortage: a.shortage,
        skipped_reason: null,
      });
    }
  }

  // Audit report is best-effort: if the migration hasn't run yet, the
  // deductions above still stand and the ledger notes carry the detail.
  const { error: reportError } = await supabase
    .from("batches")
    .update({
      auto_deduct_report: {
        deducted_at: new Date().toISOString(),
        source,
        lines: reportLines,
      },
    })
    .eq("id", batch.batchId);
  if (reportError) console.error("auto_deduct_report save:", reportError.message);

  return { allocations, substitutions, shortages, skipped };
}

/** Auto-deduct every newly brewed batch, exactly once. Skips any batch
 *  that already has usage rows (e.g. a manual pull sheet deducted it) or
 *  an existing report. */
async function autoDeductNewBatches(candidates: DeductibleBatch[]): Promise<{
  batches: number;
  allocations: number;
  substitutions: number;
  shortages: number;
  skipped: number;
}> {
  const supabase = await createServiceClient();
  let batches = 0;
  let allocations = 0;
  let substitutions = 0;
  let shortages = 0;
  let skipped = 0;
  for (const c of candidates) {
    const [{ data: txns }, { data: row }] = await Promise.all([
      supabase
        .from("inventory_transactions")
        .select("id")
        .eq("batch_id", c.batchId)
        .limit(1),
      supabase
        .from("batches")
        .select("auto_deduct_report")
        .eq("id", c.batchId)
        .single(),
    ]);
    if ((txns ?? []).length > 0 || row?.auto_deduct_report) continue;
    const r = await autoDeductBatch(c);
    batches++;
    allocations += r.allocations;
    substitutions += r.substitutions;
    shortages += r.shortages;
    skipped += r.skipped;
  }
  return { batches, allocations, substitutions, shortages, skipped };
}
