import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Card } from "@/components/ui";
import ScanUpload from "@/components/ScanUpload";
import DeleteScanButton from "@/components/DeleteScanButton";
import TankPhoto from "@/components/TankPhoto";
import { ArrowRight } from "lucide-react";

export const instant = false;

const TANKS = [1, 2, 3, 4, 5, 6];

function daysBetween(from: string) {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(from).getTime()) / 86400000)
  );
}

export default async function FermentationPage() {
  const supabase = await createClient();
  const [{ data: scans }, { data: assignments }] =
    await Promise.all([
      supabase
        .from("fermentation_scans")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30),
      supabase
        .from("tank_assignments")
        .select("tank_number,batch_id,assigned_at,volume_in_bbl")
        .is("released_at", null),
    ]);
  // Row counts for just the scans shown (all scan lines would pass the
  // 1,000-row response cap and undercount).
  const scanIds = (scans ?? []).map((s) => s.id as string);
  const { data: lines } = scanIds.length
    ? await supabase.from("fermentation_scan_lines").select("scan_id").in("scan_id", scanIds)
    : { data: [] as { scan_id: string }[] };
  const counts = new Map<string, number>();
  for (const l of lines ?? [])
    counts.set(l.scan_id, (counts.get(l.scan_id) ?? 0) + 1);

  const batchIds = (assignments ?? []).map((a) => a.batch_id);
  let batches: {
    id: string;
    batch_number: string | null;
    recipe_name: string | null;
    status: string | null;
  }[] = [];
  let readings: {
    batch_id: string;
    plato: number | null;
    temp_f: number | null;
    taken_at: string;
  }[] = [];
  if (batchIds.length > 0) {
    const [{ data: b }, { data: r }] = await Promise.all([
      supabase
        .from("batches")
        .select("id,batch_number,recipe_name,status")
        .in("id", batchIds),
      supabase
        .from("fermentation_readings")
        .select("batch_id,plato,temp_f,taken_at")
        .in("batch_id", batchIds)
        .order("taken_at", { ascending: false })
        .limit(300),
    ]);
    batches = b ?? [];
    readings = r ?? [];
  }
  const batchById = new Map(batches.map((b) => [b.id, b]));
  const latestByBatch = new Map<string, (typeof readings)[number]>();
  for (const rd of readings)
    if (!latestByBatch.has(rd.batch_id)) latestByBatch.set(rd.batch_id, rd);
  const assignByTank = new Map(
    (assignments ?? []).map((a) => [a.tank_number, a])
  );

  return (
    <div>
      <PageHeader eyebrow="Cellar" title="Fermentation" />

      {/* Tank farm */}
      <h2 className="mt-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">
        Tank farm
      </h2>
      <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {TANKS.map((n) => {
          const a = assignByTank.get(n);
          const b = a ? batchById.get(a.batch_id) : undefined;
          const latest = a ? latestByBatch.get(a.batch_id) : undefined;
          return (
            <Link
              key={n}
              href={`/fermentation/tanks/${n}`}
              className="group rounded-2xl border border-stone-200 bg-white p-3 text-center shadow-sm transition hover:border-copper-300 hover:shadow"
            >
              <TankPhoto number={n} filled={!!b} size="sm" />
              <p className="mt-1 text-xs font-bold uppercase tracking-wide text-stone-500">
                Tank {n}
              </p>
              {b ? (
                <>
                  <p className="truncate text-sm font-semibold text-stone-900">
                    {b.recipe_name ?? "Batch"}
                    {b.batch_number ? ` #${b.batch_number}` : ""}
                  </p>
                  <p className="tnum mt-0.5 text-xs text-stone-500">
                    {latest?.plato != null
                      ? `${Number(latest.plato).toFixed(1)} °P`
                      : "—"}
                    {latest?.temp_f != null ? ` · ${latest.temp_f}°F` : ""} · D
                    {a ? daysBetween(a.assigned_at) : 0}
                    {a?.volume_in_bbl != null
                      ? ` · ${Number(a.volume_in_bbl)} bbl in`
                      : ""}
                  </p>
                </>
              ) : (
                <p className="py-1 text-sm text-stone-400">Empty</p>
              )}
            </Link>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-xs text-stone-400">
        Tap a tank to see its readings, scan its sheet, or move a batch in.
        Tank assignments live here — Brewfather doesn&apos;t track tanks.
      </p>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="lg:sticky lg:top-6">
            <ScanUpload />
            <p className="mt-3 px-1 text-xs text-stone-400">
              Snap a photo of a fermentation log sheet — or upload a PDF. Each
              dated row (date, °Plato, temperature) is extracted, matched to
              its batch, and posted to the fermentation log after your review.
              Readings can also be added by hand on a batch page, or by voice
              (“log a reading for …”).
            </p>
          </div>
        </div>

        <div className="lg:col-span-3">
          <Card title="Scanned sheets">
            {(scans ?? []).length === 0 ? (
              <p className="py-2 text-sm text-stone-500">
                No scans yet. Upload a sheet to get started.
              </p>
            ) : (
              <ul className="divide-y divide-stone-100">
                {(scans ?? []).map((s) => (
                  <li key={s.id} className="flex items-center gap-1">
                    <Link
                      href={`/fermentation/${s.id}`}
                      className="flex flex-1 items-center justify-between gap-3 py-2.5 transition hover:bg-stone-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-stone-900">
                          {s.file_name ?? "Sheet scan"}
                        </span>
                        <span className="block text-xs text-stone-500">
                          {new Date(s.created_at).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}{" "}
                          · {counts.get(s.id) ?? 0} readings
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                            s.status === "posted"
                              ? "bg-green-100 text-green-800"
                              : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {s.status === "posted" ? "Posted" : "Draft"}
                        </span>
                        <ArrowRight className="h-4 w-4 text-stone-400" />
                      </span>
                    </Link>
                    {s.status === "draft" && <DeleteScanButton scanId={s.id} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
