/** Brand-aware ingredient substitution.
 *
 * The problem with plain fuzzy matching: "Weyermann Pilsner Malt" and
 * "IREKS Pilsner Malt" share only one token ("pilsner"), so a generic
 * matcher says they're different. But to a brewer they're the same malt
 * from a different maltster. This module strips brand/maltster names and
 * generic words first, then compares what actually identifies the
 * ingredient — the variety.
 *
 * Deliberately conservative: a substitution only happens when the
 * variety cores overlap strongly. A miss is reported as "skipped" on the
 * batch (visible, fixable) rather than silently deducting the wrong item.
 */

import { normalizeName } from "./match";
import { convertUnits } from "./units";

/** Maltsters, hop merchants, and yeast labs — stripped before comparing. */
const BRAND_TOKENS = new Set([
  "weyermann",
  "ireks",
  "briess",
  "rahr",
  "great",
  "western",
  "simpsons",
  "crisp",
  "muntons",
  "bestmalz",
  "best",
  "malz",
  "viking",
  "dingemans",
  "castle",
  "chateau",
  "franco",
  "belges",
  "pauls",
  "fawcett",
  "thomas",
  "gladfield",
  "voyager",
  "powell",
  "adm",
  "cargill",
  "boortmalt",
  "malteurop",
  "soufflet",
  "patagonia",
  "yakima",
  "chief",
  "ranch",
  "hopsteiner",
  "haas",
  "fermentis",
  "saflager",
  "safale",
  "safbrew",
  "white",
  "labs",
  "wyeast",
  "lallemand",
  "lalbrew",
  "mangrove",
  "jacks",
  "omega",
  "imperial",
  "bairds",
  "gambrinus",
  "proximity",
]);

/** Generic words that don't identify the variety. */
const GENERIC_TOKENS = new Set([
  "malt",
  "malts",
  "hop",
  "hops",
  "yeast",
  "pellet",
  "pellets",
  "whole",
  "leaf",
  "cones",
  "cone",
  "plug",
  "plugs",
  "flaked",
  "grain",
  "grains",
  "type",
  "special",
  "the",
  "of",
]);

/** The variety core of a name: tokens minus brands and generics. */
export function coreTokens(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .split(" ")
      .filter((t) => t.length > 0 && !BRAND_TOKENS.has(t) && !GENERIC_TOKENS.has(t))
  );
}

function f1(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  if (shared === 0) return 0;
  const coverage = shared / a.size;
  const score = (2 * shared) / (a.size + b.size);
  return coverage >= 0.6 && score >= 0.6 ? score : 0;
}

/** 0–1 similarity between a recipe ingredient and an on-hand ingredient. */
export function substitutionScore(recipeName: string, candidateName: string): number {
  if (normalizeName(recipeName) === normalizeName(candidateName)) return 1;
  return f1(coreTokens(recipeName), coreTokens(candidateName));
}

// ── Weight conversion (recipe units vs inventory units) ─────────────────

/** Convert qty between units (weight, volume, or count — see lib/units.ts);
 *  null if not convertible. Rounded to 0.01 for ledger rows. */
export function convertWeight(qty: number, from: string, to: string): number | null {
  const v = convertUnits(qty, from, to);
  return v == null ? null : Math.round(v * 100) / 100;
}

// ── Allocation ───────────────────────────────────────────────────────────

export interface StockCandidate {
  id: string;
  name: string;
  category: string;
  unit: string;
  onHand: number;
  costPerUnit: number | null;
}

export interface RecipeLine {
  name: string;
  category: string;
  amount: number | null;
  unit: string;
}

export interface Allocation {
  ingredientId: string;
  ingredientName: string;
  qty: number;
  unit: string;
  unitCost: number | null;
  substituted: boolean;
  /** True when this allocation pushed on-hand below zero. */
  shortage: boolean;
}

export interface PlanResult {
  allocations: Allocation[];
  /** Set when nothing could be deducted for this line. */
  skippedReason: string | null;
  shortage: boolean;
}

/**
 * Plan how one recipe line is covered from on-hand stock.
 * Exact brand first, then best variety match, splitting across items when
 * one item can't cover the full amount. If total stock falls short, the
 * remainder still deducts from the best candidate (driving it negative)
 * so usage stays truthful — flagged as a shortage, never silently dropped.
 */
export function planDeduction(line: RecipeLine, stock: StockCandidate[]): PlanResult {
  if (line.amount == null || line.amount <= 0) {
    return { allocations: [], skippedReason: "No amount in recipe", shortage: false };
  }
  const sameCategory = stock.filter((s) => s.category === line.category);
  if (sameCategory.length === 0) {
    return {
      allocations: [],
      skippedReason: `Nothing in ${line.category} on hand`,
      shortage: false,
    };
  }

  const scored = sameCategory
    .map((s) => ({
      s,
      score: substitutionScore(line.name, s.name),
      exact: normalizeName(s.name) === normalizeName(line.name),
    }))
    .filter(({ s, score }) => {
      if (score <= 0) return false;
      // Must be able to express the needed amount in this item's unit.
      return convertWeight(line.amount!, line.unit, s.unit) != null;
    })
    // Exact brand always wins over a substitute, even when the variety
    // cores tie; then best variety score, then largest on-hand.
    .sort((a, b) => Number(b.exact) - Number(a.exact) || b.score - a.score || b.s.onHand - a.s.onHand);

  if (scored.length === 0) {
    return {
      allocations: [],
      skippedReason: `No close match for "${line.name}" on hand`,
      shortage: false,
    };
  }

  const allocations: Allocation[] = [];
  let remaining = line.amount;
  const onHand = new Map(scored.map(({ s }) => [s.id, s.onHand]));

  for (const { s } of scored) {
    if (remaining <= 0) break;
    const available = Math.max(onHand.get(s.id) ?? 0, 0);
    if (available <= 0) continue;
    const takeInRecipeUnit = Math.min(remaining, convertWeight(available, s.unit, line.unit)!);
    const take = convertWeight(takeInRecipeUnit, line.unit, s.unit)!;
    allocations.push({
      ingredientId: s.id,
      ingredientName: s.name,
      qty: take,
      unit: s.unit,
      unitCost: s.costPerUnit,
      substituted: normalizeName(s.name) !== normalizeName(line.name),
      shortage: false,
    });
    onHand.set(s.id, available - take);
    remaining = Math.round((remaining - takeInRecipeUnit) * 100) / 100;
  }

  let shortage = false;
  if (remaining > 0) {
    // Total stock short: put the remainder on the best candidate anyway.
    const best = scored[0].s;
    const take = convertWeight(remaining, line.unit, best.unit)!;
    allocations.push({
      ingredientId: best.id,
      ingredientName: best.name,
      qty: take,
      unit: best.unit,
      unitCost: best.costPerUnit,
      substituted: normalizeName(best.name) !== normalizeName(line.name),
      shortage: true,
    });
    shortage = true;
  }

  return { allocations, skippedReason: null, shortage };
}
