/** Industry-standard brewery ingredient categories (key → label). */
export const CATEGORIES: Record<string, string> = {
  grain: "Grain & Malt",
  adjunct: "Adjuncts & Sugars",
  hops: "Hops",
  yeast: "Yeast & Bacteria",
  water: "Water & Salts",
  fining: "Fining & Process Aids",
  acid: "Acids",
  fruit: "Fruit & Flavorings",
  cleaning: "Cleaning & Sanitation",
  gas: "Gases",
  packaging: "Packaging Materials",
  other: "Other",
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export type CategoryKey = keyof typeof CATEGORIES;
