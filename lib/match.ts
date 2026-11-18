/** Name matching helpers (shared by server invoice code and client forms). */

/** Lowercase, strip punctuation/package noise for name matching. */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(lb|lbs|oz|kg|bag|bags|case|each|ea|pack)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP = new Set(["malt", "the", "of", "type", "special"]);

function tokens(s: string): Set<string> {
  return new Set(normalizeName(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t)));
}

/** Best fuzzy ingredient match for an external name (null if weak). */
export function suggestIngredientId(
  rawName: string,
  ingredients: { id: string; name: string }[]
): string | null {
  const rt = tokens(rawName);
  if (rt.size === 0) return null;
  let best: { id: string; score: number } | null = null;
  for (const ing of ingredients) {
    const it = tokens(ing.name);
    let shared = 0;
    for (const t of rt) if (it.has(t)) shared++;
    const score = shared / Math.max(rt.size, it.size);
    if (shared >= 2 && score >= 0.5 && (!best || score > best.score)) {
      best = { id: ing.id, score };
    }
  }
  return best?.id ?? null;
}
