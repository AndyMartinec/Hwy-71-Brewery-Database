/** Package sizes → gallons / barrels. 1 barrel = 31 gallons (US beer barrel). */

export const GALLONS_PER_BARREL = 31;

export const PACKAGE_GALLONS: Record<string, number> = {
  "Half-barrel keg": 15.5,
  "Sixth-barrel keg": 31 / 6, // sixtel ≈ 5.167 gal
  "Case 12oz": 2.25, // 24 × 12 oz
  "Case 16oz": 3, // 24 × 16 oz
};

export function packageGallons(packageType: string): number {
  return PACKAGE_GALLONS[packageType] ?? 0;
}

export function packageBarrels(packageType: string): number {
  return packageGallons(packageType) / GALLONS_PER_BARREL;
}
