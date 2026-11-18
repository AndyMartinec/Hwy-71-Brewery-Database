"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { presetRange, chicagoToday } from "@/lib/period";
import { inputCls } from "@/components/ui";

type Preset = "month" | "last" | "quarter" | "ytd" | "custom";

const PRESETS: { value: Exclude<Preset, "custom">; label: string }[] = [
  { value: "month", label: "This month" },
  { value: "last", label: "Last month" },
  { value: "quarter", label: "Quarter" },
  { value: "ytd", label: "Year to date" },
];

/** Shared date-range picker. The range lives in the URL (?from= & ?to=) so
 *  Reports, Accounting, and Finished Beer always agree — and a link to a
 *  report opens the same period. Beer filter is optional (Reports only). */
export default function PeriodPicker({
  from,
  to,
  preset,
  basePath,
  beers,
  beer,
}: {
  from: string;
  to: string;
  preset: Preset;
  basePath: string;
  beers?: string[];
  beer?: string;
}) {
  const router = useRouter();
  const [fromDate, setFromDate] = useState(from);
  const [toDate, setToDate] = useState(to);
  const today = chicagoToday();

  function go(nextFrom: string, nextTo: string, nextBeer?: string) {
    const q = new URLSearchParams();
    q.set("from", nextFrom);
    q.set("to", nextTo);
    const b = nextBeer ?? beer;
    if (b) q.set("beer", b);
    router.push(`${basePath}?${q.toString()}`);
  }

  const pillCls = (active: boolean) =>
    `rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ring-inset transition ${
      active
        ? "bg-ink-900 text-white ring-ink-900"
        : "bg-white text-stone-600 ring-stone-300 hover:ring-stone-400"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {PRESETS.map((p) => (
        <button
          key={p.value}
          type="button"
          className={pillCls(preset === p.value)}
          onClick={() => {
            const r = presetRange(p.value);
            go(r.from, r.to);
          }}
        >
          {p.label}
        </button>
      ))}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          aria-label="From"
          value={fromDate}
          max={toDate || today}
          onChange={(e) => setFromDate(e.target.value)}
          className={`${inputCls} w-auto px-2 py-1.5 text-sm`}
        />
        <span className="text-sm text-stone-400">–</span>
        <input
          type="date"
          aria-label="To"
          value={toDate}
          min={fromDate}
          max={today}
          onChange={(e) => setToDate(e.target.value)}
          className={`${inputCls} w-auto px-2 py-1.5 text-sm`}
        />
        <button
          type="button"
          className={pillCls(false)}
          disabled={!fromDate || !toDate || fromDate > toDate}
          onClick={() => go(fromDate, toDate)}
        >
          Apply
        </button>
      </div>
      {beers && beers.length > 0 && (
        <select
          aria-label="Beer"
          value={beer ?? ""}
          onChange={(e) => go(from, to, e.target.value || undefined)}
          className={`${inputCls} w-auto px-2 py-1.5 text-sm`}
        >
          <option value="">All beers</option>
          {beers.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
