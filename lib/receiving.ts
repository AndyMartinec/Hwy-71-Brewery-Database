/** Invoice receiving: turn "2 bag @ $55" into the ingredient's own unit
 *  ("110 lb @ $1.00/lb") before it posts. Getting this wrong poisons every
 *  cost downstream — 2 lb at $55/lb instead of 110 lb at $1/lb — so the
 *  review screen suggests the conversion and shows the resulting $/unit. */

import { convertUnits, parsePackSize, isKnownUnit, canonicalUnit } from "./units";

export interface PackInfo {
  /** Saved product details on the ingredient: one pack = pack_size pack_unit. */
  pack_size?: number | null;
  pack_unit?: string | null;
}

export interface QtySuggestion {
  qty: number;
  /** Plain-English explanation shown under the field. */
  how: string;
  /** Pack size to remember on the ingredient, when one was used. */
  pack?: { size: number; unit: string };
}

/** Suggest the quantity to add in the ingredient's unit, or null when the
 *  units can't be reconciled (the reviewer must enter it by hand). */
export function suggestQtyToAdd(
  line: { raw_name: string; qty: number | null; unit: string | null },
  ingredientUnit: string,
  pack: PackInfo | null
): QtySuggestion | null {
  const qty = line.qty;
  if (qty == null || !(qty > 0)) return null;
  const printed = line.unit?.trim() || "";

  // 1. Printed unit converts directly (lb → lb, kg → lb, g → oz).
  if (printed && isKnownUnit(printed) && canonicalUnit(printed) !== "each") {
    const direct = convertUnits(qty, printed, ingredientUnit);
    if (direct != null)
      return {
        qty: round(direct),
        how:
          canonicalUnit(printed) === canonicalUnit(ingredientUnit)
            ? `${qty} ${ingredientUnit} as printed`
            : `${qty} ${printed} = ${round(direct)} ${ingredientUnit}`,
      };
  }

  // Ingredient counted in each/pkg and the invoice counts items too.
  if (canonicalUnit(ingredientUnit) === "each" && (!printed || canonicalUnit(printed) === "each"))
    return { qty, how: `${qty} ${ingredientUnit} as printed` };

  // 2. Pack size printed in the product name ("Pale Ale 50#", "25 kg sack").
  const named = parsePackSize(line.raw_name);
  if (named) {
    const per = convertUnits(named.size, named.unit, ingredientUnit);
    if (per != null)
      return {
        qty: round(qty * per),
        how: `${qty} × ${named.size} ${named.unit} (from the product name) = ${round(qty * per)} ${ingredientUnit}`,
        pack: named,
      };
  }

  // 3. Pack size saved on the ingredient from an earlier invoice.
  if (pack?.pack_size && pack.pack_unit) {
    const per = convertUnits(Number(pack.pack_size), pack.pack_unit, ingredientUnit);
    if (per != null)
      return {
        qty: round(qty * per),
        how: `${qty} × ${pack.pack_size} ${pack.pack_unit} (saved pack size) = ${round(qty * per)} ${ingredientUnit}`,
      };
  }

  return null;
}

/** True when the printed unit and the ingredient unit plainly differ and
 *  nothing reconciles them — e.g. "bag" vs "lb" with no pack size. */
export function unitsMismatch(printedUnit: string | null, ingredientUnit: string): boolean {
  const p = canonicalUnit(printedUnit);
  if (!p) return false;
  return p !== canonicalUnit(ingredientUnit) && convertUnits(1, p, ingredientUnit) == null;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
