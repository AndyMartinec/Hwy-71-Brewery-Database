/**
 * Fermentation sheet scanning: reads a photographed / scanned fermentation
 * log sheet with a vision model and returns structured readings.
 * Server-only (uses OPENAI_API_KEY).
 */

import { normalizeName, suggestIngredientId } from "./match";

export interface ExtractedReading {
  /** Batch identifier exactly as printed (batch #, beer name, tank, …). */
  batch_label: string | null;
  /** Reading date as printed. */
  date: string | null;
  /** Gravity in degrees Plato, as printed. */
  plato: number | null;
  /** Temperature in °F (converted from °C when needed). */
  temp_f: number | null;
  /** Cellar action for that day in plain English, shorthand expanded. */
  action: string | null;
}

const PROMPT = `You are reading a brewery fermentation log sheet. Rows are cellar shorthand, one per dated reading. Extract:
- batch_label: the batch identifier EXACTLY as printed (batch number, beer name, tank — whatever the sheet uses; if the sheet covers a single batch, use the batch name/number printed at the top for every row)
- date: the reading date as YYYY-MM-DD. Dates are written month/day (9/7 = September 7); infer the year from context.
- plato: gravity in degrees Plato as a plain number. The sheet ALWAYS uses Plato, never specific gravity (if a value looks like SG, e.g. 1.052, convert it to Plato).
- temp_f: temperature as a plain number in degrees Fahrenheit (convert from Celsius if the sheet uses °C).
- action: anything written in the actions area for that row, rewritten in plain English with brewing shorthand expanded (DH = dry-hopped, # = lb/pounds). Example: "DH 1# Azacca" becomes "Dry-hopped with 1 lb Azacca". Null when the row has no action.
Example: a row reading "9/7 10.5 54 DH 1# Azacca" means September 7, gravity 10.5° Plato, 54°F, dry-hopped with 1 lb of Azacca that day.
Skip header rows, empty rows, and target/schedule rows that are not actual readings.
Respond with JSON only:
{"lines":[{"batch_label":..., "date":..., "plato":..., "temp_f":..., "action":...}]}
Use null for anything not present. Numbers must be plain numbers.`;

/** Degrees Plato -> specific gravity (standard brewing formula). */
export function platoToSG(plato: number): number {
  const sg = 1 + plato / (258.6 - (plato / 258.2) * 227.1);
  return Math.round(sg * 10000) / 10000;
}

export async function extractFermentationSheet(
  fileBytes: Buffer,
  mimeType: string,
  filename: string
): Promise<{ lines: ExtractedReading[] } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const b64 = fileBytes.toString("base64");
  const isPdf = mimeType === "application/pdf";
  const filePart = isPdf
    ? {
        type: "file",
        file: { filename, file_data: `data:application/pdf;base64,${b64}` },
      }
    : {
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${b64}` },
      };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: PROMPT }, filePart],
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Sheet reading failed (${res.status}). Try a clearer photo, or enter the readings manually.`
    );
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = json.choices?.[0]?.message?.content ?? '{"lines":[]}';
  const parsed = JSON.parse(content) as { lines?: ExtractedReading[] };
  return { lines: Array.isArray(parsed.lines) ? parsed.lines : [] };
}

export interface MatchableBatch {
  id: string;
  batch_number: string | null;
  recipe_name: string;
}

/** Numeric value of a batch number ("#35" -> 35). NaN when not numeric. */
function batchNum(b: MatchableBatch): number {
  const m = (b.batch_number ?? "").match(/\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

/**
 * Best batch for a beer name: among batches whose recipe name shares a word
 * with the label, the HIGHEST batch number wins (higher number = more recent
 * brew). Non-numeric batch numbers fall back to the given order, which the
 * caller sorts most-recent-first.
 */
export function matchBatchByBeer(
  label: string | null,
  batches: MatchableBatch[]
): string | null {
  if (!label) return null;
  const tokens = (t: string) =>
    new Set(
      normalizeName(t)
        .split(" ")
        .filter((w) => w.length > 1)
    );
  const labelTokens = tokens(label);
  if (labelTokens.size === 0) return null;
  const lab = normalizeName(label);
  const candidates = batches.filter((b) => {
    const name = normalizeName(b.recipe_name ?? "");
    const nameTokens = tokens(b.recipe_name ?? "");
    for (const t of labelTokens) if (nameTokens.has(t)) return true;
    return !!name && !!lab && (name.includes(lab) || lab.includes(name));
  });
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestN = batchNum(best);
  for (const c of candidates.slice(1)) {
    const n = batchNum(c);
    if (!isNaN(n) && (isNaN(bestN) || n > bestN)) {
      best = c;
      bestN = n;
    }
  }
  return best.id;
}

/** Match a printed batch label to a batch: exact batch-number hit first,
 *  then beer-name match with the highest batch number. Null when nothing
 *  is close. */
export function matchBatchId(
  label: string | null,
  batches: MatchableBatch[]
): string | null {
  if (!label) return null;
  const norm = normalizeName(label);
  // Batch number: compare digits (sheets often print "Batch #12" or "12").
  const digits = norm.replace(/[^0-9]/g, "");
  if (digits) {
    const hit = batches.find(
      (b) => b.batch_number && normalizeName(b.batch_number).replace(/[^0-9]/g, "") === digits
    );
    if (hit) return hit.id;
  }
  return matchBatchByBeer(label, batches);
}
