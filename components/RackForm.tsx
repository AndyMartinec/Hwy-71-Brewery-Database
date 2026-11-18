"use client";

import { useState } from "react";
import { rackTank } from "@/lib/actions";

/** Rack a tank: barrels in, live keg preview, kegs out to inventory. */
export default function RackForm({ tank }: { tank: number }) {
  const [bbl, setBbl] = useState("");
  const [date, setDate] = useState(() =>
    new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" })
  );
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Chicago",
  });

  const n = Number(bbl);
  const kegs = n > 0 ? n * 2 : 0;
  const valid = n > 0 && Number.isInteger(kegs);

  return (
    <form
      action={rackTank}
      className="flex flex-wrap items-end gap-2 rounded-xl bg-green-50/60 p-3"
    >
      <input type="hidden" name="tank_number" value={tank} />
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
          Barrels racked
        </label>
        <input
          type="number"
          name="volume_out_bbl"
          step="0.5"
          min="0.5"
          inputMode="decimal"
          required
          value={bbl}
          onChange={(e) => setBbl(e.target.value)}
          placeholder="e.g. 4"
          className="tnum w-28 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </div>
      <div className="tnum px-1 py-2 text-sm font-semibold text-stone-700">
        = {bbl === "" ? "—" : valid ? `${kegs} kegs` : "?"}
      </div>
      <div>
        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">
          Rack date
        </label>
        <input
          type="date"
          name="racked_at"
          required
          value={date}
          max={today}
          onChange={(e) => setDate(e.target.value)}
          className="tnum rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        />
      </div>
      <button
        type="submit"
        className="rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-green-800"
      >
        Rack beer
      </button>
      {bbl !== "" && !valid && (
        <p className="w-full text-xs text-red-700">
          Barrels must be in half-barrel increments (0.5 bbl = 1 keg).
        </p>
      )}
      <p className="w-full text-xs text-stone-500">
        Records the barrelage, empties the tank, and adds the kegs to finished
        beer inventory.
      </p>
    </form>
  );
}
