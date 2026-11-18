import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assignTank, emptyTank, updateTankVolumeIn, retryBrewfatherPush, sendTankReadingToBrewfather } from "@/lib/actions";
import { streamConfigured } from "@/lib/brewfather";
import { deviceName } from "@/lib/brewfather-stream";
import FermentationCurve from "@/components/FermentationCurve";
import RackForm from "@/components/RackForm";
import { liveAbv } from "@/lib/abv";
import { PageHeader, Card, primaryBtn } from "@/components/ui";
import TankPhoto from "@/components/TankPhoto";
import ScanUpload from "@/components/ScanUpload";
import { ArrowLeft, AlertTriangle } from "lucide-react";

export const instant = false;

function daysBetween(from: string) {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(from).getTime()) / 86400000)
  );
}

export default async function TankDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ n: string }>;
  searchParams: Promise<{ bfpush?: string; reason?: string; bfstream?: string; detail?: string }>;
}) {
  const { n } = await params;
  const { bfpush, reason, bfstream, detail } = await searchParams;
  const tank = Number(n);
  if (!tank || tank < 1 || tank > 6) notFound();

  const supabase = await createClient();
  const [
    { data: assignment },
    { data: lastRack },
    { data: allCurrent },
    { data: activeBatches },
  ] = await Promise.all([
    supabase
      .from("tank_assignments")
      .select("batch_id,assigned_at,volume_in_bbl")
      .eq("tank_number", tank)
      .is("released_at", null)
      .maybeSingle(),
    supabase
      .from("tank_assignments")
      .select("volume_out_bbl,released_at")
      .eq("tank_number", tank)
      .not("volume_out_bbl", "is", null)
      .order("released_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("tank_assignments")
      .select("tank_number,batch_id")
      .is("released_at", null),
    supabase
      .from("batches")
      .select("id,batch_number,recipe_name,status")
      .in("status", ["Brewing", "Fermenting"])
      .order("updated_at", { ascending: false })
      .limit(200),
  ]);

  const occupiedElsewhere = new Set(
    (allCurrent ?? [])
      .filter((a) => a.tank_number !== tank)
      .map((a) => a.batch_id)
  );

  let batch: {
    id: string;
    batch_number: string | null;
    recipe_name: string | null;
    status: string | null;
    recipe_id: string | null;
    og: number | null;
  } | null = null;
  let readings: {
    id: string;
    taken_at: string;
    plato: number | null;
    gravity: number | null;
    temp_f: number | null;
    note: string | null;
  }[] = [];
  if (assignment) {
    const [{ data: b }, { data: r }] = await Promise.all([
      supabase
        .from("batches")
        .select("id,batch_number,recipe_name,status,recipe_id,og")
        .eq("id", assignment.batch_id)
        .single(),
      supabase
        .from("fermentation_readings")
        .select("id,taken_at,plato,gravity,temp_f,note")
        .eq("batch_id", assignment.batch_id)
        .order("taken_at", { ascending: false })
        .limit(100),
    ]);
    batch = b;
    readings = r ?? [];
  }

  // Last reading sent to Brewfather for this tank (table is optional:
  // a missing brewfather-stream.sql just means no status line).
  const streamOn = streamConfigured();
  const { data: lastStream } = streamOn
    ? await supabase
        .from("brewfather_stream_log")
        .select("status,detail,pushed_at")
        .eq("tank_number", tank)
        .order("pushed_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const { data: tankRecipe } = batch?.recipe_id
    ? await supabase
        .from("recipes")
        .select("og,ibu")
        .eq("id", batch.recipe_id)
        .maybeSingle()
    : { data: null };

  const eligible = (activeBatches ?? []).filter(
    (b) => !occupiedElsewhere.has(b.id)
  );
  const latest = readings[0] ?? null;
  const doneish =
    batch && ["Completed", "Conditioning"].includes(batch.status ?? "");

  return (
    <div>
      <Link
        href="/fermentation"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-stone-500 transition hover:text-copper-700"
      >
        <ArrowLeft className="h-4 w-4" /> Tank farm
      </Link>
      <PageHeader
        eyebrow={`Tank ${tank}`}
        title={batch ? batch.recipe_name ?? "Batch" : "Empty"}
      />

      {bfpush === "failed" && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1 text-sm text-amber-900">
            <span className="font-semibold">
              Racked, but Brewfather wasn&apos;t updated.
            </span>{" "}
            {reason === "scope"
              ? "Your API key needs the batches.write scope — Brewfather → Settings → API."
              : "The push failed; your batch is marked Completed here and the next sync will keep trying to read it back."}{" "}
            Retry once the key is fixed.
          </div>
          <form action={retryBrewfatherPush}>
            <input type="hidden" name="tank_number" value={tank} />
            <button
              type="submit"
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
            >
              Retry push
            </button>
          </form>
        </div>
      )}

      {bfpush === "ok" && (
        <div className="mt-4 rounded-xl border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900">
          <span className="font-semibold">Brewfather updated</span> — batch
          marked Completed with final gravity and kegged volume.
        </div>
      )}

      {bfstream && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            bfstream === "sent"
              ? "border-green-300 bg-green-50 text-green-900"
              : bfstream === "failed"
                ? "border-red-300 bg-red-50 text-red-900"
                : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          <span className="font-semibold">
            {bfstream === "sent" ? "Sent to Brewfather." : bfstream === "failed" ? "Brewfather didn't take it." : "Not sent."}
          </span>{" "}
          {detail}
        </div>
      )}

      {batch && streamOn && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3">
          <div className="min-w-0 flex-1 text-sm text-stone-600">
            <span className="font-semibold text-stone-900">Brewfather device &ldquo;{deviceName(tank)}&rdquo;</span>
            <span className="block text-xs text-stone-500">
              {lastStream
                ? `Last ${lastStream.status === "sent" ? "sent" : "attempt failed"} ${new Date(lastStream.pushed_at).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}: ${lastStream.detail ?? ""}`
                : "Newest reading goes to Brewfather each time a sheet is posted. Link this device to the batch in Brewfather once per brew."}
            </span>
          </div>
          <form action={sendTankReadingToBrewfather}>
            <input type="hidden" name="tank_number" value={tank} />
            <button
              type="submit"
              className="rounded-lg border border-copper-300 px-3 py-2 text-xs font-semibold text-copper-800 transition hover:bg-copper-50"
            >
              Send to Brewfather
            </button>
          </form>
        </div>
      )}

      {doneish && (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="flex-1 text-sm text-amber-900">
            <span className="font-semibold">
              This batch is marked {batch!.status} in Brewfather.
            </span>{" "}
            Empty the tank once it&apos;s transferred.
          </div>
          <form action={emptyTank}>
            <input type="hidden" name="tank_number" value={tank} />
            <button
              type="submit"
              className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
            >
              Empty tank
            </button>
          </form>
        </div>
      )}

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card title={`Tank ${tank}`}>
          <div className="flex items-center gap-6">
            <TankPhoto number={tank} filled={!!batch} size="lg" />
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-stone-400">
                  Contents
                </dt>
                <dd className="font-semibold text-stone-900">
                  {batch
                    ? `${batch.recipe_name ?? "Batch"}${
                        batch.batch_number ? ` #${batch.batch_number}` : ""
                      }`
                    : "Empty"}
                </dd>
              </div>
              {assignment && (
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-stone-400">
                    In tank
                  </dt>
                  <dd className="text-stone-700">
                    Day {daysBetween(assignment.assigned_at)} · since{" "}
                    {new Date(assignment.assigned_at).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-[11px] uppercase tracking-[0.12em] text-stone-400">
                  Latest reading
                </dt>
                <dd className="tnum text-stone-700">
                  {latest ? (
                    <>
                      {latest.plato != null
                        ? `${Number(latest.plato).toFixed(1)} °P`
                        : latest.gravity ?? "—"}
                      {latest.temp_f != null ? ` · ${latest.temp_f}°F` : ""}
                    </>
                  ) : (
                    "No readings yet"
                  )}
                </dd>
              </div>
              {assignment && (
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-stone-400">
                    Wort in
                  </dt>
                  <dd>
                    <form action={updateTankVolumeIn} className="flex items-center gap-2">
                      <input type="hidden" name="tank_number" value={tank} />
                      <input
                        type="number"
                        name="volume_in_bbl"
                        step="0.1"
                        min="0"
                        inputMode="decimal"
                        defaultValue={
                          assignment.volume_in_bbl != null
                            ? Number(assignment.volume_in_bbl)
                            : ""
                        }
                        placeholder="bbl"
                        className="tnum w-20 rounded-lg border border-stone-300 bg-white px-2 py-1 text-sm"
                      />
                      <span className="text-sm text-stone-500">bbl</span>
                      <button
                        type="submit"
                        className="text-xs font-semibold text-copper-700 hover:underline"
                      >
                        Save
                      </button>
                    </form>
                  </dd>
                </div>
              )}
              {lastRack && (
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-stone-400">
                    Last rack
                  </dt>
                  <dd className="tnum text-stone-700">
                    {Number(lastRack.volume_out_bbl).toFixed(2)} bbl (
                    {Number(lastRack.volume_out_bbl) * 2} kegs) ·{" "}
                    {new Date(lastRack.released_at).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    })}
                  </dd>
                </div>
              )}
              {batch && (
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-stone-400">
                    ABV
                  </dt>
                  <dd className="tnum font-semibold text-copper-700">
                    {(() => {
                      const og =
                        batch.og != null
                          ? Number(batch.og)
                          : tankRecipe?.og != null
                            ? Number(tankRecipe.og)
                            : null;
                      const sg =
                        latest?.gravity != null ? Number(latest.gravity) : null;
                      const abv = liveAbv(og, sg);
                      return abv != null ? `${abv.toFixed(1)}% live` : "—";
                    })()}
                  </dd>
                </div>
              )}
              {batch && tankRecipe?.ibu != null && (
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-stone-400">
                    IBU
                  </dt>
                  <dd className="tnum text-stone-700">
                    {Math.round(Number(tankRecipe.ibu))}
                  </dd>
                </div>
              )}
              {batch?.status && (
                <div>
                  <dt className="text-[11px] uppercase tracking-[0.12em] text-stone-400">
                    Brewfather status
                  </dt>
                  <dd className="text-stone-700">{batch.status}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="mt-4 border-t border-stone-100 pt-4">
            {batch ? (
              <div className="space-y-3">
                <RackForm tank={tank} />
              <div className="flex flex-wrap items-center gap-3">
                <form action={assignTank} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="tank_number" value={tank} />
                  <select
                    name="batch_id"
                    defaultValue=""
                    required
                    className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Move a different batch in…</option>
                    {eligible
                      .filter((b) => b.id !== batch.id)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.batch_number ? `#${b.batch_number} — ` : ""}
                          {b.recipe_name} ({b.status})
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    name="volume_in_bbl"
                    step="0.1"
                    min="0"
                    inputMode="decimal"
                    placeholder="bbl in"
                    title="Barrels of wort racked in"
                    className="tnum w-24 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                  />
                  <button type="submit" className={primaryBtn}>
                    Change batch
                  </button>
                </form>
                <form action={emptyTank}>
                  <input type="hidden" name="tank_number" value={tank} />
                  <button
                    type="submit"
                    className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-600 transition hover:border-red-300 hover:text-red-700"
                  >
                    Empty tank
                  </button>
                </form>
              </div>
              </div>
            ) : (
              <form action={assignTank} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="tank_number" value={tank} />
                <select
                  name="batch_id"
                  defaultValue=""
                  required
                  className="flex-1 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Choose a fermenting batch…</option>
                  {eligible.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.batch_number ? `#${b.batch_number} — ` : ""}
                      {b.recipe_name} ({b.status})
                    </option>
                  ))}
                </select>
                <button type="submit" className={primaryBtn}>
                  Put in tank
                </button>
              </form>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          {batch ? (
            <ScanUpload
              presetBatchId={batch.id}
              title={`Scan Tank ${tank}'s sheet`}
            />
          ) : (
            <Card title="Scan a sheet">
              <p className="py-2 text-sm text-stone-500">
                Put a batch in this tank first — then its sheets will post
                straight to that batch.
              </p>
            </Card>
          )}

          <Card title="Fermentation curve">
            <FermentationCurve readings={readings} />
          </Card>

          <Card title="Readings">
            {readings.length === 0 ? (
              <p className="py-1 text-sm text-stone-500">No readings yet.</p>
            ) : (
              <div className="-mx-5 -my-4 max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-white">
                    <tr className="border-b border-stone-100 text-left text-[11px] uppercase tracking-[0.12em] text-stone-400">
                      <th className="px-5 py-2.5 font-semibold">Date</th>
                      <th className="px-3 py-2.5 font-semibold">Gravity</th>
                      <th className="px-3 py-2.5 font-semibold">Temp</th>
                      <th className="px-5 py-2.5 font-semibold">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {readings.map((r) => (
                      <tr key={r.id} className="transition hover:bg-stone-50">
                        <td className="whitespace-nowrap px-5 py-2.5 text-stone-600">
                          {new Date(r.taken_at).toLocaleString([], {
                            month: "numeric",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="tnum px-3 py-2.5">
                          {r.plato != null ? (
                            <>
                              <span className="font-medium">
                                {Number(r.plato).toFixed(1)} °P
                              </span>
                              <div className="text-[11px] font-normal text-stone-400">
                                {r.gravity != null
                                  ? Number(r.gravity).toFixed(3)
                                  : ""}
                              </div>
                            </>
                          ) : (
                            <span className="font-medium">
                              {r.gravity ?? "—"}
                            </span>
                          )}
                        </td>
                        <td className="tnum px-3 py-2.5">
                          {r.temp_f ? `${r.temp_f}°F` : "—"}
                        </td>
                        <td className="px-5 py-2.5 text-stone-600">
                          {r.note ?? ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
