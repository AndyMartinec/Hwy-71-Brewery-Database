"use client";

import { setBeerPrice } from "@/lib/actions";

/** Inline pint-price editor used on the Accounting margin table. */
export default function BeerPriceForm({
  beer,
  price,
}: {
  beer: string;
  price: number | null;
}) {
  return (
    <form
      className="inline-flex items-center gap-1.5"
      action={async (formData: FormData) => {
        await setBeerPrice(beer, Number(formData.get("price")));
      }}
    >
      <span className="text-stone-400">$</span>
      <input
        name="price"
        type="number"
        step="0.01"
        min="0.01"
        required
        defaultValue={price != null ? price.toFixed(2) : ""}
        placeholder="7.00"
        className="tnum w-20 rounded-md border border-stone-300 bg-white px-2 py-1 text-right text-sm text-stone-900 focus:border-copper-500 focus:outline-none"
      />
      <button
        type="submit"
        className="rounded-md bg-ink-900 px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-ink-700"
      >
        Save
      </button>
    </form>
  );
}
