/** Recipe-based batch costing: price a recipe's ingredient bill against the
 *  current ingredient catalog. Used as the cost basis for a beer when no
 *  completed batches exist to cost from yet. */

import { normalizeName } from "./match";
import { convertUnits } from "./units";

export interface CatalogItem {
  id: string;
  name: string;
  unit: string;
  cost_per_unit: number | null;
}

export interface RecipeLine {
  name: string;
  category: string;
  amount: number | null;
  unit: string;
}

export interface RecipeCostLine {
  name: string;
  amount: number | null;
  unit: string;
  /** $ per catalog unit (see catalogUnit). */
  unitCost: number | null;
  lineCost: number | null;
  /** The matched catalog item's unit, e.g. "lb": what unitCost is per. */
  catalogUnit: string | null;
  /** Name of the catalog item the line was priced from. */
  matchedName: string | null;
}

export interface RecipeCost {
  /** $ for the full recipe batch (costed lines only). */
  total: number;
  costPerGal: number | null;
  costPerBbl: number | null;
  lines: RecipeCostLine[];
  /** Names of lines that couldn't be priced (no match or no cost). */
  uncosted: string[];
  batchSizeGal: number | null;
}

/** Convert an amount between units (weight, volume, or count — see
 *  lib/units.ts); null when not convertible. Kept under its old name for
 *  the order planner, which totals recipe needs in catalog units. */
export function convertWeight(
  amount: number,
  from: string,
  toUnit: string
): number | null {
  return convertUnits(amount, from, toUnit);
}

const STOP = new Set(["the", "of", "type", "special"]);
// Note: unlike invoice matching, "malt" is NOT a stop word here — it's the
// token that lets a recipe line like "Pilsner Malt" match a catalog item
// like "IREKS Pilsner Malt".

function tokens(s: string): Set<string> {
  return new Set(
    normalizeName(s)
      .split(" ")
      .filter((t) => t.length > 1 && !STOP.has(t))
  );
}

/** Best catalog match for a recipe line: exact normalized name first, then
 *  token overlap (same rule as invoice matching). Exported for the order
 *  planner, which matches recipe needs to on-hand stock. */
export function matchCatalog(
  lineName: string,
  catalog: CatalogItem[]
): CatalogItem | null {
  const norm = normalizeName(lineName);
  const exact = catalog.find((c) => normalizeName(c.name) === norm);
  if (exact) return exact;
  const rt = tokens(lineName);
  if (rt.size === 0) return null;
  let best: { item: CatalogItem; score: number } | null = null;
  for (const item of catalog) {
    const it = tokens(item.name);
    let shared = 0;
    for (const t of rt) if (it.has(t)) shared++;
    const score = shared / Math.max(rt.size, it.size);
    if (shared >= 2 && score >= 0.5 && (!best || score > best.score)) {
      best = { item, score };
    }
  }
  return best?.item ?? null;
}

export function costRecipe(
  lines: RecipeLine[],
  catalog: CatalogItem[],
  batchSizeGal: number | null
): RecipeCost {
  const out: RecipeCostLine[] = [];
  const uncosted: string[] = [];
  let total = 0;

  for (const line of lines) {
    const item = matchCatalog(line.name, catalog);
    let unitCost: number | null = null;
    let lineCost: number | null = null;
    if (item && item.cost_per_unit != null && line.amount != null) {
      const qty = convertWeight(line.amount, line.unit, item.unit);
      if (qty != null) {
        unitCost = Number(item.cost_per_unit);
        lineCost = qty * unitCost;
        total += lineCost;
      }
    }
    if (lineCost == null) uncosted.push(line.name);
    out.push({
      name: line.name,
      amount: line.amount,
      unit: line.unit,
      unitCost,
      lineCost,
      catalogUnit: item?.unit ?? null,
      matchedName: item?.name ?? null,
    });
  }

  const gal = batchSizeGal != null && batchSizeGal > 0 ? batchSizeGal : null;
  return {
    total,
    costPerGal: gal != null && total > 0 ? total / gal : null,
    costPerBbl: gal != null && total > 0 ? (total / gal) * 31 : null,
    lines: out,
    uncosted,
    batchSizeGal: gal,
  };
}
