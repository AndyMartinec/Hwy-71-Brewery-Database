/** Send each tank's newest fermentation reading to Brewfather.
 *
 *  Brewfather has no API for writing readings, so this goes through its
 *  Custom Stream (see pushStreamReading): each tank is a device named
 *  "Tank N" that you link to the batch inside Brewfather once per brew.
 *  Only the newest reading per tank is sent. Brewfather stamps readings
 *  with the time they arrive, so a whole sheet's history would pile up on
 *  one minute; the full day-by-day log stays in this app. The reading's
 *  real date rides along in the comment.
 *
 *  Never throws: the local post always stands, and every outcome comes
 *  back as a line the UI can show. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { pushStreamReading, streamConfigured } from "./brewfather";

export interface StreamPushResult {
  tank: number | null;
  batch: string;
  status: "sent" | "skipped" | "failed";
  detail: string;
}

/** Brewfather accepts one reading per device every 15 minutes. */
export const STREAM_INTERVAL_MS = 15 * 60 * 1000;

export function deviceName(tank: number): string {
  return `Tank ${tank}`;
}

/** Build the reading Brewfather receives (pure; unit-checked). */
export function streamPayload(input: {
  tank: number;
  recipeName: string | null;
  batchNumber: string | null;
  takenAt: string;
  plato: number | null;
  gravity: number | null;
  tempF: number | null;
  note: string | null;
}) {
  const date = input.takenAt.slice(0, 10);
  const beer = [input.recipeName, input.batchNumber ? `#${input.batchNumber}` : null]
    .filter(Boolean)
    .join(" ");
  return {
    name: deviceName(input.tank),
    temp: input.tempF,
    temp_unit: "F" as const,
    gravity: input.plato ?? input.gravity,
    gravity_unit: (input.plato != null ? "P" : "G") as "P" | "G",
    beer: beer || undefined,
    comment: `Reading of ${date}${input.note ? `: ${input.note}` : ""} (from Highway 71 Ops)`,
  };
}

export async function pushLatestReadings(
  supabase: SupabaseClient,
  batchIds: string[],
  opts: { force?: boolean } = {}
): Promise<StreamPushResult[]> {
  if (!streamConfigured() || batchIds.length === 0) return [];
  const out: StreamPushResult[] = [];

  const [{ data: tanks }, { data: batches }] = await Promise.all([
    supabase
      .from("tank_assignments")
      .select("tank_number,batch_id")
      .in("batch_id", batchIds)
      .is("released_at", null),
    supabase.from("batches").select("id,recipe_name,batch_number").in("id", batchIds),
  ]);
  const tankByBatch = new Map((tanks ?? []).map((t) => [t.batch_id as string, Number(t.tank_number)]));
  const batchById = new Map((batches ?? []).map((b) => [b.id as string, b]));

  for (const batchId of [...new Set(batchIds)]) {
    const b = batchById.get(batchId);
    const label = b
      ? `${b.recipe_name ?? "Batch"}${b.batch_number ? ` #${b.batch_number}` : ""}`
      : "Batch";
    const tank = tankByBatch.get(batchId) ?? null;
    if (tank == null) {
      out.push({ tank, batch: label, status: "skipped", detail: "Not in a tank, so there's no Brewfather device to send to." });
      continue;
    }

    const { data: reading } = await supabase
      .from("fermentation_readings")
      .select("id,taken_at,plato,gravity,temp_f,note")
      .eq("batch_id", batchId)
      .or("plato.not.is.null,gravity.not.is.null")
      .order("taken_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!reading) {
      out.push({ tank, batch: label, status: "skipped", detail: "No gravity reading to send yet." });
      continue;
    }

    // Throttle and de-duplicate from the push log. If the log table isn't
    // there yet (brewfather-stream.sql not run), send without the check.
    const { data: last, error: logReadErr } = await supabase
      .from("brewfather_stream_log")
      .select("reading_id,pushed_at")
      .eq("tank_number", tank)
      .eq("status", "sent")
      .order("pushed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!logReadErr && last) {
      if (last.reading_id === reading.id && !opts.force) {
        out.push({ tank, batch: label, status: "skipped", detail: "Brewfather already has this reading." });
        continue;
      }
      const wait = new Date(last.pushed_at).getTime() + STREAM_INTERVAL_MS - Date.now();
      if (wait > 0) {
        out.push({
          tank,
          batch: label,
          status: "skipped",
          detail: `Brewfather takes one reading per tank every 15 minutes. Use "Send to Brewfather" on the Tank ${tank} page in ${Math.ceil(wait / 60000)} min.`,
        });
        continue;
      }
    }

    let status: "sent" | "failed" = "sent";
    let detail = "";
    try {
      await pushStreamReading(
        streamPayload({
          tank,
          recipeName: b?.recipe_name ?? null,
          batchNumber: b?.batch_number ?? null,
          takenAt: String(reading.taken_at),
          plato: reading.plato != null ? Number(reading.plato) : null,
          gravity: reading.gravity != null ? Number(reading.gravity) : null,
          tempF: reading.temp_f != null ? Number(reading.temp_f) : null,
          note: reading.note,
        })
      );
      const g = reading.plato != null ? `${Number(reading.plato).toFixed(1)} °P` : Number(reading.gravity).toFixed(3);
      detail = `Sent ${g}${reading.temp_f != null ? `, ${reading.temp_f}°F` : ""} (reading of ${String(reading.taken_at).slice(0, 10)}).`;
    } catch (e) {
      status = "failed";
      detail = e instanceof Error ? e.message : String(e);
    }
    const { error: logErr } = await supabase.from("brewfather_stream_log").insert({
      tank_number: tank,
      batch_id: batchId,
      reading_id: reading.id,
      status,
      detail,
    });
    if (logErr) console.warn("brewfather_stream_log:", logErr.message);
    out.push({ tank, batch: label, status, detail });
  }
  return out;
}
