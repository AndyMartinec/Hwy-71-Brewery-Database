"use client";

/** Print the current report — the period lives in the URL, so the printout
 *  is always the period on screen. */
export default function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-full bg-white px-3.5 py-1.5 text-sm font-semibold text-stone-600 ring-1 ring-inset ring-stone-300 transition hover:ring-stone-400"
    >
      Print
    </button>
  );
}
