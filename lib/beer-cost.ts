/** Shared cost basis for a beer, used by Accounting and Reports.
 *  One rule everywhere: completed-batch actuals first, recipe estimate
 *  fallback. Extracted verbatim from the Accounting page (Nov 2 build) so
 *  both pages can never drift apart. */

import { costRecipe, type CatalogItem, type RecipeLine, type RecipeCost } from "./recipe-cost";
import { normalizeName } from "./match";

export interface BatchCostRow {
  id: string;
  recipe_name: string;
  recipe_id: string | null;
  status: string;
  batch_size_gal: number | null;
}

export interface UsageRow {
  batch_id: string | null;
  qty_change: number;
  unit_cost: number | null;
  ingredients: { cost_per_unit: number | null } | null;
}

export interface RecipeRow {
  id: string;
  name: string;
  batch_size_gal: number | null;
  ingredients: unknown;
}

export type BeerCost = {
  perGal: number | null;
  basis: "actual" | "recipe" | null;
  uncosted: string[];
};

export interface BeerCostBook {
  /** Total ingredient cost already pulled into each batch. */
  batchCost: Map<string, number>;
  /** Gallons the batch's cost is spread over: packaged/racked volume when
   *  known, else the planned batch size. */
  batchGallons: (batchId: string) => number | null;
  /** Actual $/gal for one batch (its usage ÷ its gallons), null if unknown. */
  batchPerGal: (batchId: string) => number | null;
  recipeCostById: Map<string, RecipeCost>;
  recipeCostByName: Map<string, RecipeCost>;
  beerCost: (beerName: string) => BeerCost;
}

export function buildBeerCost(
  batches: BatchCostRow[],
  usage: UsageRow[],
  recipes: RecipeRow[],
  catalog: CatalogItem[],
  /** Gallons actually packaged per batch (racking + packaging movements).
   *  Cost per gallon uses this before the planned batch size, so losses to
   *  trub, dry hops, and dumps raise the real cost per pint. */
  packagedGalByBatch: Map<string, number> = new Map()
): BeerCostBook {
  // ── Cost of every batch from its ingredient usage (actuals) ──
  const batchCost = new Map<string, number>();
  for (const t of usage) {
    if (!t.batch_id) continue;
    const perUnit =
      t.unit_cost != null ? Number(t.unit_cost) : Number(t.ingredients?.cost_per_unit ?? 0);
    // Usage rows are negative; a positive row against a batch is stock
    // returned to inventory and credits the batch.
    batchCost.set(t.batch_id, (batchCost.get(t.batch_id) ?? 0) - Number(t.qty_change) * perUnit);
  }

  const batchById = new Map(batches.map((b) => [b.id, b]));
  const batchGallons = (batchId: string): number | null => {
    const packaged = packagedGalByBatch.get(batchId);
    if (packaged != null && packaged > 0) return packaged;
    const planned = batchById.get(batchId)?.batch_size_gal;
    return planned != null && Number(planned) > 0 ? Number(planned) : null;
  };
  const batchPerGal = (batchId: string): number | null => {
    const cost = batchCost.get(batchId) ?? 0;
    const gal = batchGallons(batchId);
    return gal != null && cost > 0 ? cost / gal : null;
  };

  // ── Recipe cost engine: price each recipe's bill against the catalog ──
  const catalogItems = catalog.map((c) => ({
    ...c,
    cost_per_unit: c.cost_per_unit != null ? Number(c.cost_per_unit) : null,
  }));
  const recipeCostById = new Map<string, RecipeCost>();
  const recipeCostByName = new Map<string, RecipeCost>();
  for (const r of recipes) {
    const lines = (Array.isArray(r.ingredients) ? r.ingredients : []) as unknown as RecipeLine[];
    const cost = costRecipe(
      lines,
      catalogItems,
      r.batch_size_gal != null ? Number(r.batch_size_gal) : null
    );
    recipeCostById.set(r.id, cost);
    recipeCostByName.set(normalizeName(r.name), cost);
  }

  // ── Cost per gallon by beer: completed-batch actuals first, recipe fallback ──
  const actualPerGal = new Map<string, number>();
  {
    const agg = new Map<string, { cost: number; gal: number }>();
    for (const b of batches) {
      if (b.status !== "Completed") continue;
      const gal = batchGallons(b.id);
      const cost = batchCost.get(b.id) ?? 0;
      // A completed batch with no logged usage would drag the average to $0.
      if (!gal || cost <= 0) continue;
      const a = agg.get(b.recipe_name) ?? { cost: 0, gal: 0 };
      a.cost += cost;
      a.gal += gal;
      agg.set(b.recipe_name, a);
    }
    for (const [name, a] of agg)
      if (a.gal > 0 && a.cost > 0) actualPerGal.set(name, a.cost / a.gal);
  }

  const beerCost = (beerName: string): BeerCost => {
    const actual = actualPerGal.get(beerName);
    if (actual) return { perGal: actual, basis: "actual", uncosted: [] };
    const rc = recipeCostByName.get(normalizeName(beerName));
    if (rc?.costPerGal) return { perGal: rc.costPerGal, basis: "recipe", uncosted: rc.uncosted };
    return { perGal: null, basis: null, uncosted: [] };
  };

  return { batchCost, batchGallons, batchPerGal, recipeCostById, recipeCostByName, beerCost };
}

/** Sum packaged gallons per batch from finished-goods rows (reason
 *  "packaged", which racking and the packaging form both write). */
export function packagedGallonsByBatch(
  rows: { batch_id: string | null; reason: string; package_type: string; qty_change: number }[],
  gallonsPerPackage: (pkg: string) => number
): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.reason !== "packaged" || !r.batch_id) continue;
    out.set(r.batch_id, (out.get(r.batch_id) ?? 0) + Number(r.qty_change) * gallonsPerPackage(r.package_type));
  }
  return out;
}
