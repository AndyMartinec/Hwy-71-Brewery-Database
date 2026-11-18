/** One unit-conversion engine for the whole app: recipe costing, order
 *  planning, auto-deduct substitution, and invoice receiving all convert
 *  through here, so a hop bill in grams, a misc in mL, or yeast in packs
 *  prices and deducts the same way everywhere.
 *
 *  Three families — weight, volume, count. Conversion only happens inside a
 *  family (you can't turn grams into mL without a density), and returns
 *  null when it can't, so callers flag the line instead of guessing. */

type Family = "weight" | "volume" | "count";

/** Canonical unit → [family, factor to the family's base unit]. Bases:
 *  weight = gram, volume = millilitre, count = each. */
const UNITS: Record<string, [Family, number]> = {
  g: ["weight", 1],
  kg: ["weight", 1000],
  mg: ["weight", 0.001],
  oz: ["weight", 28.349523125],
  lb: ["weight", 453.59237],

  ml: ["volume", 1],
  l: ["volume", 1000],
  tsp: ["volume", 4.92892159375],
  tbsp: ["volume", 14.78676478125],
  floz: ["volume", 29.5735295625],
  cup: ["volume", 236.5882365],
  qt: ["volume", 946.352946],
  gal: ["volume", 3785.411784],

  each: ["count", 1],
};

/** Spellings seen on invoices, Brewfather, and hand entry → canonical unit.
 *  Packs, vials, sachets, and "items" are all one countable thing. */
const ALIASES: Record<string, string> = {
  gram: "g", grams: "g", gr: "g",
  kilo: "kg", kilos: "kg", kilogram: "kg", kilograms: "kg", kgs: "kg",
  milligram: "mg", milligrams: "mg",
  ounce: "oz", ounces: "oz",
  lbs: "lb", pound: "lb", pounds: "lb", "#": "lb",
  milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml", mls: "ml",
  liter: "l", liters: "l", litre: "l", litres: "l", ltr: "l",
  teaspoon: "tsp", teaspoons: "tsp",
  tablespoon: "tbsp", tablespoons: "tbsp", tbs: "tbsp",
  "fl oz": "floz", "fl. oz": "floz", "fl.oz": "floz", "fluid ounce": "floz", "fluid ounces": "floz",
  cups: "cup",
  quart: "qt", quarts: "qt",
  gallon: "gal", gallons: "gal",
  ea: "each", item: "each", items: "each", unit: "each", units: "each",
  pc: "each", pcs: "each", piece: "each", pieces: "each",
  pkg: "each", pkgs: "each", package: "each", packages: "each",
  pack: "each", packs: "each", packet: "each", packets: "each",
  vial: "each", vials: "each", sachet: "each", sachets: "each",
  tablet: "each", tablets: "each", tab: "each", tabs: "each",
};

/** Canonical form of a unit string ("Lbs" → "lb", "Packages" → "each"),
 *  or the trimmed lowercase input when unknown. */
export function canonicalUnit(unit: string | null | undefined): string {
  const u = (unit ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (UNITS[u]) return u;
  return ALIASES[u] ?? u;
}

/** True when the unit is one the engine understands. */
export function isKnownUnit(unit: string | null | undefined): boolean {
  return UNITS[canonicalUnit(unit)] != null;
}

/** Convert an amount between units of the same family; null when the units
 *  are unknown or of different families (weight ↔ volume needs a density). */
export function convertUnits(amount: number, from: string, to: string): number | null {
  const f = canonicalUnit(from);
  const t = canonicalUnit(to);
  if (f === t) return amount;
  const fu = UNITS[f];
  const tu = UNITS[t];
  if (!fu || !tu || fu[0] !== tu[0]) return null;
  return (amount * fu[1]) / tu[1];
}

/** Pull a package size out of a product name as printed on an invoice:
 *  "Briess Pale Ale 50#" → 50 lb, "Pilsner Malt 25kg" → 25 kg,
 *  "Citra T90 44 LB box" → 44 lb, "Lactic Acid 1 gal" → 1 gal.
 *  Returns null when there's no size in the name. */
export function parsePackSize(name: string): { size: number; unit: string } | null {
  const m = name.match(
    /(\d+(?:\.\d+)?)\s*(#|lbs?|pounds?|kgs?|kilos?|g|grams?|oz|ounces?|gal(?:lons?)?|l|liters?|litres?|ml)\b|(\d+(?:\.\d+)?)\s*#/i
  );
  if (!m) return null;
  const size = parseFloat(m[1] ?? m[3]);
  const unit = canonicalUnit(m[2] ?? "#");
  if (!(size > 0) || !isKnownUnit(unit)) return null;
  return { size, unit };
}

/** Pick a sensible number of decimals for a per-unit price: $0.0042/g
 *  should not render as $0.00. */
export function formatUnitCost(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 1 ? 2 : abs >= 0.1 ? 3 : 4;
  return `$${n.toFixed(digits)}`;
}
