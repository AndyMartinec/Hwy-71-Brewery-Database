import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import KegMovementForm, { type MovementBatch } from "@/components/KegMovementForm";
import TapForm from "@/components/TapForm";
import PeriodPicker from "@/components/PeriodPicker";
import VoiceCommandBar from "@/components/VoiceCommandBar";
import { PageHeader, Card, Stat } from "@/components/ui";
import { packageBarrels } from "@/lib/packages";
import { parsePeriod } from "@/lib/period";

export const instant = false;

export default async function BeerPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; period?: string }>;
}) {
  const supabase = await createClient();
  // Shared period — the opening barrels below are the ledger before `from`.
  const p = parsePeriod(await searchParams);
  const monthStart = new Date(p.startISO);

  const [{ data: stock }, { data: earlyTxns }, { data: batches }] = await Promise.all([
    supabase.from("finished_stock").select("*").order("beer_name"),
    // Whole ledger before the period, paginated past the 1,000-row cap.
    fetchAll((a, b) =>
      supabase
        .from("finished_goods_transactions")
        .select("beer_name,package_type,qty_change")
        .lt("created_at", monthStart.toISOString())
        .order("created_at")
        .order("id")
        .range(a, b)
    ),
    supabase.from("batches").select("id,recipe_name,batch_number").order("batch_number", { ascending: false }),
  ]);
  const movementBatches = ((batches ?? []) as unknown as MovementBatch[]);

  const byBeer = new Map<string, { package_type: string; on_hand: number }[]>();
  for (const s of stock ?? []) {
    if (!byBeer.has(s.beer_name)) byBeer.set(s.beer_name, []);
    byBeer.get(s.beer_name)!.push({ package_type: s.package_type, on_hand: Number(s.on_hand) });
  }

  const barrelsOf = (rows: { package_type: string; on_hand: number }[]) =>
    rows.reduce((n, r) => n + r.on_hand * packageBarrels(r.package_type), 0);

  const totalPackages = (stock ?? []).reduce((n, s) => n + Number(s.on_hand), 0);
  const totalBarrels = barrelsOf(stock ?? []);

  // Barrels on hand at the start of this month (for month-end tax reporting).
  const monthStartMap = new Map<string, number>();
  for (const t of earlyTxns ?? []) {
    const key = `${t.beer_name}|${t.package_type}`;
    monthStartMap.set(key, (monthStartMap.get(key) ?? 0) + Number(t.qty_change));
  }
  const monthStartBarrels = [...monthStartMap.entries()].reduce(
    (n, [key, qty]) => n + qty * packageBarrels(key.split("|")[1]),
    0
  );

  return (
    <div>
      <PageHeader
        eyebrow="Inventory"
        title="Finished Beer Inventory"
        action={<PeriodPicker from={p.from} to={p.to} preset={p.preset} basePath="/beer" />}
      />
      <VoiceCommandBar />

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Barrels on hand" value={totalBarrels.toFixed(2)} sub="all beers, all packages" />
        <Stat label="Packages on hand" value={String(totalPackages)} sub="kegs & cases" />
        <Stat
          label={`Barrels — ${p.from}`}
          value={monthStartBarrels.toFixed(2)}
          sub="opening position for tax reporting"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card title="On hand — by beer">
            <div className="-mx-5 -my-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                    <th className="px-5 py-2.5 font-semibold">Beer</th>
                    <th className="px-3 py-2.5 font-semibold">Package</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Qty</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Barrels</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {[...byBeer.entries()].flatMap(([beer, pkgs]) =>
                    pkgs.map((p, i) => (
                      <tr key={`${beer}-${p.package_type}`} className="transition hover:bg-stone-50">
                        <td className="px-5 py-3 font-medium text-stone-900">{i === 0 ? beer : ""}</td>
                        <td className="px-3 py-3 text-stone-500">{p.package_type}</td>
                        <td className="tnum px-3 py-3 text-right font-semibold text-stone-900">
                          {Number.isInteger(p.on_hand) ? p.on_hand : p.on_hand.toFixed(2)}
                        </td>
                        <td className="tnum px-5 py-3 text-right text-stone-600">
                          {(p.on_hand * packageBarrels(p.package_type)).toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                  {byBeer.size === 0 && (
                    <tr>
                      <td colSpan={4} className="px-5 py-6 text-center text-stone-500">
                        No packaged beer on hand.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="mt-3 px-1 text-xs text-stone-400">
            A half-barrel keg = 0.50 bbl, a sixth-barrel = 0.17 bbl (1 bbl = 31 gal). The
            beginning/end-of-month barrel counts are what the TABC and TTB reports are built
            from — every movement is dated in the ledger, so any month can be reconstructed.
          </p>
        </div>

        <div className="lg:col-span-2">
          <div className="space-y-4 lg:sticky lg:top-6">
            <KegMovementForm beers={[...byBeer.keys()]} batches={movementBatches} />
            <TapForm beers={[...byBeer.keys()]} batches={movementBatches} />
          </div>
        </div>
      </div>
    </div>
  );
}
