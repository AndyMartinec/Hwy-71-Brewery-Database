/** Live ABV from original gravity and a current/final gravity (both SG).
 *  Standard (OG - FG) x 131.25 formula, 1 decimal. Returns null when the
 *  inputs aren't there; clamps nonsense (FG > OG) at 0. */
export function liveAbv(
  og: number | null | undefined,
  fgSg: number | null | undefined
): number | null {
  if (og == null || fgSg == null) return null;
  const abv = (Number(og) - Number(fgSg)) * 131.25;
  if (!isFinite(abv)) return null;
  return Math.round(Math.max(0, abv) * 10) / 10;
}
