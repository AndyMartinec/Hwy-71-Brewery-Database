/** Excise tax on beer — one rule, shared by Accounting and Reports so the
 *  two pages can never show different tax for the same period.
 *
 *  Beer sold (taxable removals) = beginning inventory + produced − ending
 *  inventory, per beer, less destructions that carry a TABC approval
 *  reference. Unapproved destruction stays inside the difference, so it
 *  stays taxable. (Decided Nov 5, 2026 — see docs/REPORTS-DESIGN.md.) */

import { packageBarrels } from "./packages";

/** Texas excise on beer, $/bbl (TABC). */
export const TABC_PER_BBL = 6.0;
/** Federal excise, reduced CBMA rate for the first 60,000 bbl/yr removed by
 *  a domestic brewer producing ≤ 2M bbl, $/bbl (TTB). */
export const TTB_PER_BBL = 3.5;

export interface FgLedgerRow {
  beer_name: string;
  package_type: string;
  qty_change: number;
  reason: string;
  approval_ref?: string | null;
  created_at: string;
}

export interface BeerExcise {
  openingBbl: number;
  closingBbl: number;
  producedBbl: number;
  destroyedApprovedBbl: number;
  /** beginning + produced − ending (can be negative when counts are off). */
  derivedSoldBbl: number;
  /** max(0, derived sold − approved destruction). */
  taxableBbl: number;
}

/** Per-beer excise position for a period [startISO, endISO). */
export function exciseByBeer(
  rows: FgLedgerRow[],
  startISO: string,
  endISO: string
): Map<string, BeerExcise> {
  const out = new Map<string, BeerExcise>();
  const get = (beer: string) => {
    let e = out.get(beer);
    if (!e) {
      e = { openingBbl: 0, closingBbl: 0, producedBbl: 0, destroyedApprovedBbl: 0, derivedSoldBbl: 0, taxableBbl: 0 };
      out.set(beer, e);
    }
    return e;
  };
  for (const r of rows) {
    const e = get(r.beer_name);
    const bbl = Number(r.qty_change) * packageBarrels(r.package_type);
    if (r.created_at < startISO) e.openingBbl += bbl;
    if (r.created_at < endISO) e.closingBbl += bbl;
    if (r.created_at < startISO || r.created_at >= endISO) continue;
    if (r.reason === "packaged") e.producedBbl += Math.max(0, bbl);
    if (r.reason === "destroyed" && r.approval_ref) e.destroyedApprovedBbl += Math.abs(bbl);
  }
  for (const e of out.values()) {
    e.derivedSoldBbl = e.openingBbl + e.producedBbl - e.closingBbl;
    e.taxableBbl = Math.max(0, e.derivedSoldBbl - e.destroyedApprovedBbl);
  }
  return out;
}
