/** Shared reporting period: one ?from= & ?to= (calendar dates, America/Chicago)
 *  used by Reports, Accounting, and Finished Beer, so every number on a page
 *  answers for the same range. Bounds are noon UTC (= morning in Chicago),
 *  the same convention racking already uses to stamp its date — the calendar
 *  date is stable in the brewery's timezone.
 *
 *  Opening = ledger rows with created_at < startISO.
 *  Activity = created_at >= startISO AND < endISO.
 *  Closing  = ledger rows with created_at < endISO.
 */

export interface Period {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD, inclusive
  startISO: string;
  endISO: string; // exclusive: day after `to` at noon UTC
  label: string;
  preset: "month" | "last" | "quarter" | "ytd" | "custom";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function chicagoToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function chicagoParts(d: Date): { y: number; m: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), day: get("day") };
}

function fmt(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function monthLabel(from: string): string {
  const [y, m] = from.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function toPeriod(from: string, to: string, preset: Period["preset"], label: string): Period {
  return {
    from,
    to,
    startISO: `${from}T12:00:00Z`,
    endISO: `${addDays(to, 1)}T12:00:00Z`,
    label,
    preset,
  };
}

/** Resolve ?from/&to, falling back to ?period=last, else this month-to-date. */
export function parsePeriod(sp: {
  from?: string;
  to?: string;
  period?: string;
}): Period {
  const today = chicagoToday();
  const { y, m } = chicagoParts(new Date());

  if (sp.from && DATE_RE.test(sp.from) && sp.to && DATE_RE.test(sp.to) && sp.from <= sp.to) {
    const [fy, fm] = sp.from.split("-").map(Number);
    const lastDay = addDays(fmt(fy, fm + 1, 1), -1);
    const isFullMonth = sp.from.endsWith("-01") && sp.to === lastDay;
    return toPeriod(
      sp.from,
      sp.to,
      "custom",
      isFullMonth ? monthLabel(sp.from) : `${sp.from} – ${sp.to}`
    );
  }

  if (sp.period === "last") {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    const first = fmt(py, pm, 1);
    const last = addDays(fmt(py, pm + 1, 1), -1);
    return toPeriod(first, last, "last", monthLabel(first));
  }

  // Default: this month, 1st through today.
  return toPeriod(fmt(y, m, 1), today, "month", monthLabel(fmt(y, m, 1)));
}

/** Preset ranges for the picker (client-side, computed in Chicago time). */
export function presetRange(preset: "month" | "last" | "quarter" | "ytd"): {
  from: string;
  to: string;
} {
  const today = chicagoToday();
  const { y, m } = chicagoParts(new Date());
  if (preset === "last") {
    const py = m === 1 ? y - 1 : y;
    const pm = m === 1 ? 12 : m - 1;
    return { from: fmt(py, pm, 1), to: addDays(fmt(py, pm + 1, 1), -1) };
  }
  if (preset === "quarter") {
    const qm = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: fmt(y, qm, 1), to: today };
  }
  if (preset === "ytd") return { from: fmt(y, 1, 1), to: today };
  return { from: fmt(y, m, 1), to: today };
}
