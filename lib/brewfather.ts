// Brewfather REST API client — https://docs.brewfather.app/api
// Auth: HTTP Basic with base64("<userid>:<apikey>").
// Reads use v1 (150 calls/hour/key); writes use v2 (500 calls/hour/key,
// v1 is deprecated). v2 PATCH /batches/:id accepts status + measured values.
// Fermentation *readings* have no write endpoint (GET-only by design —
// readings enter Brewfather via device streams or manual entry), so the
// app's fermentation log stays the system of record for readings.

const BASE = "https://api.brewfather.app/v1";
const BASE_V2 = "https://api.brewfather.app/v2";

export type BrewfatherStatus =
  | "Planning"
  | "Brewing"
  | "Fermenting"
  | "Conditioning"
  | "Completed"
  | "Archived";

export interface BrewfatherBatch {
  _id: string;
  name: string;
  batchNo?: number;
  status: BrewfatherStatus;
  brewer?: string;
  brewDate?: number; // epoch ms
  batchSize?: number; // liters
  recipe?: { name?: string; [k: string]: unknown };
  measuredOg?: number;
  measuredFg?: number;
  fermentation?: unknown;
  [k: string]: unknown;
}

export interface BrewfatherInventoryItem {
  _id: string;
  name: string;
  inventory?: number;
  unit?: string;
  [k: string]: unknown;
}

export type InventoryCategory =
  | "fermentables"
  | "hops"
  | "yeasts"
  | "miscs";

function authHeader(): string {
  const userId = process.env.BREWFATHER_USER_ID;
  const apiKey = process.env.BREWFATHER_API_KEY;
  if (!userId || !apiKey) {
    throw new Error("Brewfather credentials are not configured (BREWFATHER_USER_ID / BREWFATHER_API_KEY).");
  }
  return "Basic " + Buffer.from(`${userId}:${apiKey}`).toString("base64");
}

async function bfFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After") ?? "60";
    throw new Error(`Brewfather rate limit hit (429). Retry after ${retryAfter}s.`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Brewfather API ${res.status}: ${body.slice(0, 300)}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function paged<T>(path: string, params: Record<string, string | number | boolean>): Promise<T[]> {
  const out: T[] = [];
  const limit = 50;
  let offset = 0;
  for (;;) {
    const q = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      limit: String(limit),
      offset: String(offset),
    });
    const page = await bfFetch<T[]>(`${path}?${q}`);
    out.push(...page);
    if (page.length < limit) break;
    offset += limit;
  }
  return out;
}

/** List batches for one status. complete=true returns full batch JSON. */
export function listBatches(status: BrewfatherStatus): Promise<BrewfatherBatch[]> {
  return paged<BrewfatherBatch>("/batches", { status, complete: true });
}

export function getBatch(id: string): Promise<BrewfatherBatch> {
  return bfFetch<BrewfatherBatch>(`/batches/${id}`);
}

async function bfPatchV2<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_V2}${path}`, {
    method: "PATCH",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After") ?? "60";
    throw new Error(`Brewfather rate limit hit (429). Retry after ${retryAfter}s.`);
  }
  if (!res.ok) {
    const bodyText = await res.text().catch(() => "");
    throw new Error(`Brewfather API ${res.status}: ${bodyText.slice(0, 300)}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export interface BatchPushUpdate {
  status?: BrewfatherStatus;
  /** Final gravity, SG (e.g. 1.012). */
  measuredFg?: number | null;
  /** Kegged/bottled volume, liters. */
  measuredBottlingSize?: number | null;
}

/**
 * Push a batch update to Brewfather (v2). Requires the batches.write scope
 * on the API key. Only the provided fields are updated.
 */
export function pushBatchUpdate(id: string, update: BatchPushUpdate): Promise<void> {
  const body: Record<string, unknown> = {};
  if (update.status) body.status = update.status;
  if (update.measuredFg != null) body.measuredFg = update.measuredFg;
  if (update.measuredBottlingSize != null) body.measuredBottlingSize = update.measuredBottlingSize;
  return bfPatchV2<void>(`/batches/${id}`, body);
}

/** Update a batch's status via the v2 API. */
export function setBatchStatus(id: string, status: BrewfatherStatus): Promise<void> {
  return pushBatchUpdate(id, { status });
}

/** Liters in a US beer barrel (31 gal). */
export const LITERS_PER_BARREL = 31 * 3.78541;

export interface BrewfatherRecipe {
  _id: string;
  name: string;
  style?: { name?: string } | string;
  batchSize?: number; // liters
  og?: number;
  fg?: number;
  abv?: number;
  ibu?: number;
  fermentables?: Record<string, unknown>[];
  hops?: Record<string, unknown>[];
  yeasts?: Record<string, unknown>[];
  miscs?: Record<string, unknown>[];
  [k: string]: unknown;
}

/** List all recipes (complete=true asks for full ingredient bills). */
export function listRecipes(): Promise<BrewfatherRecipe[]> {
  return paged<BrewfatherRecipe>("/recipes", { complete: true });
}

export function getRecipe(id: string): Promise<BrewfatherRecipe> {
  return bfFetch<BrewfatherRecipe>(`/recipes/${id}`);
}

/** List inventory items that have stock on hand. */
export function listInventory(
  category: InventoryCategory
): Promise<BrewfatherInventoryItem[]> {
  return paged<BrewfatherInventoryItem>(`/inventory/${category}`, {
    inventory_exists: true,
  });
}

/** List ALL inventory items in a category (the catalog, stocked or not). */
export function listInventoryCatalog(
  category: InventoryCategory
): Promise<BrewfatherInventoryItem[]> {
  return paged<BrewfatherInventoryItem>(`/inventory/${category}`, {});
}

/** Adjust a Brewfather inventory item by +/- amount (same units as stored). */
export function adjustInventory(
  category: InventoryCategory,
  id: string,
  delta: number
): Promise<void> {
  return bfFetch<void>(
    `/inventory/${category}/${id}?inventory_adjust=${delta}`,
    { method: "PATCH" }
  );
}

/** Set a Brewfather inventory item to an absolute amount. */
export function setInventory(
  category: InventoryCategory,
  id: string,
  amount: number
): Promise<void> {
  return bfFetch<void>(`/inventory/${category}/${id}?inventory=${amount}`, {
    method: "PATCH",
  });
}

export const INVENTORY_CATEGORIES: InventoryCategory[] = [
  "fermentables",
  "hops",
  "yeasts",
  "miscs",
];

/** Quick connectivity check — returns true if credentials work. */
export async function checkConnection(): Promise<{ ok: boolean; detail: string }> {
  try {
    await bfFetch("/batches?status=Planning&limit=1");
    return { ok: true, detail: "Connected to Brewfather API." };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

// ── Custom Stream: send fermentation readings into Brewfather ──────────
// The REST API has no readings endpoint, but Brewfather's "Custom Stream"
// (Settings → Power-ups → Custom Stream) accepts device-style readings by
// HTTP POST. Brewfather stamps each reading with the time it arrives (no
// back-dating), shows it on the batch the device is linked to, and takes at
// most one reading per device every 15 minutes. Each tank is one device.
// https://docs.brewfather.app/integrations/custom-stream

export interface StreamReading {
  /** Device name in Brewfather, e.g. "Tank 3". */
  name: string;
  temp?: number | null;
  temp_unit?: "F" | "C";
  gravity?: number | null;
  /** "P" = °Plato, "G" = specific gravity. */
  gravity_unit?: "P" | "G";
  beer?: string;
  comment?: string;
}

/** The logging URL from Brewfather, set as BREWFATHER_STREAM_URL. Only
 *  Brewfather's own logging host is accepted, so readings can't be sent
 *  anywhere else by a mistyped setting. */
function streamUrl(): URL | null {
  const raw = process.env.BREWFATHER_STREAM_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!/(^|\.)brewfather\.(net|app)$/.test(u.hostname)) return null;
    if (!u.searchParams.get("id")) return null;
    u.protocol = "https:";
    return u;
  } catch {
    return null;
  }
}

export function streamConfigured(): boolean {
  return streamUrl() != null;
}

/** Send one reading to Brewfather's Custom Stream. Throws on failure. */
export async function pushStreamReading(r: StreamReading): Promise<void> {
  const url = streamUrl();
  if (!url) throw new Error("BREWFATHER_STREAM_URL isn't set (Brewfather → Settings → Power-ups → Custom Stream).");
  const body: Record<string, unknown> = { name: r.name };
  if (r.temp != null) {
    body.temp = r.temp;
    body.temp_unit = r.temp_unit ?? "F";
  }
  if (r.gravity != null) {
    body.gravity = r.gravity;
    body.gravity_unit = r.gravity_unit ?? "G";
  }
  if (r.beer) body.beer = r.beer;
  if (r.comment) body.comment = r.comment.slice(0, 200);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Brewfather stream ${res.status}: ${text.slice(0, 200)}`);
  // The stream answers 200 with a JSON result; a non-success result means
  // the reading was refused (e.g. sent again within 15 minutes).
  try {
    const j = JSON.parse(text) as { result?: string; message?: string };
    if (j.result && !["success", "ok"].includes(String(j.result).toLowerCase())) throw new Error(`Brewfather refused the reading: ${j.message ?? j.result}`);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Brewfather refused")) throw e;
  }
}
